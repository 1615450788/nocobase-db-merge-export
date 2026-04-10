#!/usr/bin/env node

/**
 * NocoBase 数据库导出合并工具
 * 用于在应用版本升级时，导出部分数据库结构并从另一个数据库填充数据
 * 支持 MySQL / MariaDB
 */

const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const path = require('path');

// 驼峰命名转下划线命名
function camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

// 下划线命名转驼峰命名
function snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
}

// 根据 DB_UNDERSCORED 配置转换表名
function convertTableName(tableName, dbUnderscored) {
    if (!tableName) return tableName;

    if (dbUnderscored === true) {
        // 启用 DB_UNDERSCORED: 驼峰 -> 下划线
        return camelToSnake(tableName);
    } else if (dbUnderscored === false) {
        // 禁用 DB_UNDERSCORED: 下划线 -> 驼峰
        return snakeToCamel(tableName);
    }

    // 未配置或为 'auto'，保持原样
    return tableName;
}

// 批量转换表名数组
function convertTableNames(tableNames, dbUnderscored) {
    if (!Array.isArray(tableNames)) return tableNames;
    return tableNames.map(name => convertTableName(name, dbUnderscored));
}

// 预设环境数据表（approval定义的环境数据表）
const PRESET_ENV_TABLES = [
    'workflow_cc_tasks',
    'user_workflow_tasks',
    'approval_records',
    'approval_executions',
    'jobs',
    'executions',
    'approvals',
    'workflow_stats',
    'environment_variables',
    'authenticators',
    'data_sources',
    'notification_channels',
    'notification_send_logs'
];

// 读取配置文件
async function loadConfig(configPath = './config.json') {
    try {
        const configData = await fs.readFile(configPath, 'utf8');
        return JSON.parse(configData);
    } catch (error) {
        console.error(`✗ 读取配置文件失败: ${error.message}`);
        process.exit(1);
    }
}

// 创建数据库连接
async function createConnection(config) {
    try {
        const connection = await mysql.createConnection({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            charset: 'utf8mb4',  // 强制使用 utf8mb4 字符集
            supportBigNumbers: true,
            bigNumberStrings: true  // 将 BIGINT 作为字符串返回，避免精度丢失
        });
        return connection;
    } catch (error) {
        console.error(`✗ 连接数据库失败 [${config.database}]: ${error.message}`);
        throw error;
    }
}

// 生成 SQL 文件头部注释
function generateSQLHeader(sourceConfig, targetConfig, excludeTables) {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').replace(/\..+/, '');

    let header = '';
    header += '-- ============================================================\n';
    header += '-- NocoBase Configuration Data Export Tool\n';
    header += '-- ============================================================\n';
    header += '--\n';
    header += `-- Export Time: ${timestamp}\n`;
    header += '--\n';
    header += '-- SOURCE DATABASE:\n';
    header += `--   Host:     ${sourceConfig.host}:${sourceConfig.port}\n`;
    header += `--   Database: ${sourceConfig.database}\n`;
    header += `--   User:     ${sourceConfig.user}\n`;
    header += '--\n';
    if (excludeTables && excludeTables.length > 0) {
        header += '-- EXCLUDED BUSINESS TABLES (Not Exported):\n';
        excludeTables.forEach(table => {
            header += `--   - ${table}\n`;
        });
    } else {
        header += '-- EXCLUDED TABLES: None\n';
    }
    header += '--\n';
    header += '-- USAGE:\n';
    header += '--   mysql -u username -p target_database_name < this_file.sql\n';
    header += '--\n';
    header += '-- WARNING: This script will TRUNCATE the configuration tables\n';
    header += '--          before inserting the new data.\n';
    header += '-- ============================================================\n';
    header += '\n';
    // 添加MySQL兼容的字符集设置，防止乱码
    header += 'SET NAMES utf8mb4;\n';
    header += '/*!40101 SET NAMES utf8mb4 */;\n';
    header += 'SET FOREIGN_KEY_CHECKS=0;\n\n';
    return header;
}

// 核心逻辑重构：只导出单库的配置数据，通过 TRUNCATE 来实现目标覆盖
async function exportConfigurationData(sourceConfig, configTables, outputFile, header) {
    return new Promise((resolve, reject) => {
        console.log(`\n[2/2] 从 source 数据库导出配置数据...`);
        console.log(`   共将导出 ${configTables.length} 个配置表的数据`);

        const config = sourceConfig;

        // 生成清空表的 SQL
        let truncateSQL = '';
        configTables.forEach(table => {
            truncateSQL += `TRUNCATE TABLE \`${table}\`;\n`;
        });
        truncateSQL += '\n';

        // mysqldump 参数：只导出数据，不带建结构，排除业务表，完整的 insert 语句
        const args = [
            '-h', config.host,
            '-P', config.port.toString(),
            '-u', config.user,
            '--single-transaction',
            '--skip-lock-tables',
            '--skip-add-locks',
            '--hex-blob',
            '--no-create-info',
            '--complete-insert',
            '--skip-triggers',
            '--default-character-set=utf8mb4',
            config.database
        ];

        // 仅导出 configTables，为了避免命令行过长，我们通过获取完整的数据库数据，然后忽略掉其他的表
        // 但对于大量表，更好的方式是只指定要导出的表。
        // MySQL dump 支持将多个表名跟在数据库名后面: mysqldump db_name t1 t2 t3
        const CHUNK_SIZE = 50; // 分批导出，避免命令行参数过长
        const env = { ...process.env };
        if (config.password) {
            env.MYSQL_PWD = config.password;
        }

        // 先写入头部和 truncate 语句
        const fs = require('fs');
        try {
            fs.writeFileSync(outputFile, header + truncateSQL, 'utf8');
        } catch (err) {
            return reject(new Error(`写入文件头部失败: ${err.message}`));
        }

        // 分批导出表的函数
        const exportBatch = (tables) => {
            return new Promise((res, rej) => {
                const batchArgs = [...args, ...tables];
                const dumpProcess = spawn('mysqldump', batchArgs, { env });
                
                dumpProcess.stdout.setEncoding('utf8');
                dumpProcess.stderr.setEncoding('utf8');
                
                let errors = '';
                
                // 使用流追加到文件，避免内存溢出
                const writeStream = fs.createWriteStream(outputFile, { flags: 'a', encoding: 'utf8' });
                dumpProcess.stdout.pipe(writeStream);
                
                dumpProcess.stderr.on('data', (data) => {
                    errors += data;
                });
                
                dumpProcess.on('close', (code) => {
                    writeStream.end();
                    if (code !== 0) {
                        rej(new Error(`mysqldump 失败: ${errors}`));
                    } else {
                        res();
                    }
                });
                
                dumpProcess.on('error', (err) => {
                    writeStream.end();
                    rej(new Error(`执行 mysqldump 失败: ${err.message}`));
                });
            });
        };

        // 串行执行批次
        const runBatches = async () => {
            try {
                for (let i = 0; i < configTables.length; i += CHUNK_SIZE) {
                    const batch = configTables.slice(i, i + CHUNK_SIZE);
                    console.log(`   导出批次: ${i + 1} - ${i + batch.length} / ${configTables.length}`);
                    await exportBatch(batch);
                }
                
                // 追加尾部
                fs.appendFileSync(outputFile, '\nSET FOREIGN_KEY_CHECKS=1;\n', 'utf8');
                resolve();
            } catch (err) {
                reject(err);
            }
        };

        runBatches();
    });
}

// 获取所有基础表并过滤出配置表（完全忽略视图 VIEWs）
async function getConfigTables(sourceConn, excludeTables) {
    // 从 information_schema 过滤掉视图（VIEW），只获取真正的基础表（BASE TABLE）
    const [rows] = await sourceConn.query(
        `SELECT table_name 
         FROM information_schema.tables 
         WHERE table_schema = DATABASE() 
         AND table_type = 'BASE TABLE'`
    );
    const allTables = rows.map(row => row.table_name);
    
    // 过滤掉排除的表
    const configTables = allTables.filter(table => !excludeTables.includes(table));
    return { allTables, configTables };
}

// 获取排除表的多对多关联表（junction tables）
async function getM2MJunctionTables(sourceConn, excludeTables, dbUnderscored) {
    try {
        console.log('\n🔍 查询多对多关联表...');

        const junctionTables = [];

        // 检查 fields 表是否存在
        const [tableCheck] = await sourceConn.query(
            "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'fields'",
            []
        );

        if (tableCheck[0].count === 0) {
            console.log('   ⚠ fields 表不存在，跳过多对多关联表查询');
            return junctionTables;
        }

        // 查询排除表的多对多字段
        // 注意: collections 表中存储的是原始表名（通常是驼峰命名）
        const placeholders = excludeTables.map(() => '?').join(',');
        const query = `
            SELECT
                f.collection_name,
                f.name as field_name,
                f.options
            FROM fields f
            WHERE f.collection_name IN (${placeholders})
            AND f.interface = 'm2m'
            AND f.options IS NOT NULL
        `;

        const [fields] = await sourceConn.query(query, excludeTables);

        console.log(`   ✓ 找到 ${fields.length} 个多对多字段`);

        // 解析 options JSON 获取 through 属性
        for (const field of fields) {
            try {
                // options 是 longtext 类型，包含 JSON 字符串
                const options = typeof field.options === 'string'
                    ? JSON.parse(field.options)
                    : field.options;

                if (options && options.through) {
                    // through 属性存储的是原始表名（驼峰命名）
                    const throughTableName = options.through;

                    // 根据 DB_UNDERSCORED 配置转换表名
                    const convertedTableName = convertTableName(throughTableName, dbUnderscored);

                    junctionTables.push(convertedTableName);

                    if (dbUnderscored !== undefined) {
                        console.log(`   ✓ ${field.collection_name}.${field.field_name} -> ${throughTableName} (转换为: ${convertedTableName})`);
                    } else {
                        console.log(`   ✓ ${field.collection_name}.${field.field_name} -> ${convertedTableName}`);
                    }
                }
            } catch (error) {
                console.log(`   ⚠ 解析字段 ${field.collection_name}.${field.field_name} 的 options 失败: ${error.message}`);
            }
        }

        // 去重
        const uniqueJunctionTables = [...new Set(junctionTables)];

        if (uniqueJunctionTables.length > 0) {
            console.log(`   ✓ 共找到 ${uniqueJunctionTables.length} 个唯一的多对多关联表:`);
            uniqueJunctionTables.forEach(table => console.log(`      - ${table}`));
        } else {
            console.log('   ℹ 未找到多对多关联表');
        }

        return uniqueJunctionTables;

    } catch (error) {
        console.error(`   ✗ 查询多对多关联表失败: ${error.message}`);
        return [];
    }
}

// 合并导出的 SQL
async function mergeExports(config) {
    const { source, export: exportConfig } = config;
    let { excludeTables, outputFile, dbUnderscored } = exportConfig;

    // 自动为输出文件添加时间戳（如果还没有）
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');

    // 检查文件名中是否已有时间戳模式（8位数字_6位数字）
    if (!/\d{8}_\d{6}/.test(outputFile)) {
        // 在 .sql 前插入时间戳
        outputFile = outputFile.replace(/\.sql$/, `_${timestamp}.sql`);
    }

    // 对排除表列表去重（初始去重，如果是从配置读取的）
    const originalCount = excludeTables.length;
    excludeTables = [...new Set(excludeTables)];
    const duplicateCount = originalCount - excludeTables.length;

    console.log('='.repeat(60));
    console.log('NocoBase 配置数据全量导出工具');
    console.log('='.repeat(60));
    console.log(`Source 数据库: ${source.database}`);
    console.log(`输出文件: ${outputFile}`);
    if (dbUnderscored !== undefined) {
        console.log(`DB_UNDERSCORED: ${dbUnderscored ? '启用' : '禁用'}`);
    }
    if (duplicateCount > 0) {
        console.log(`⚠ 检测到 ${duplicateCount} 个重复表名已自动去重`);
    }
    console.log('='.repeat(60));

    let sourceConn = null;

    try {
        // 步骤 0: 连接 source 数据库，获取多对多关联表
        console.log(`\n[0/2] 连接 source 数据库，查询多对多关联表...`);
        sourceConn = await createConnection(source);
        console.log(`   ✓ 连接成功`);

        // 动态获取业务表（如果排除表列表为空）
        if (excludeTables.length === 0) {
            console.log(`\n📋 排除表列表为空，自动从 collections 表动态获取业务表...`);
            const dynamicTables = await getDynamicBusinessTables(sourceConn, source, dbUnderscored);

            // 合并预设的环境数据表（approval定义的环境数据）
            const allTables = [...new Set([...dynamicTables, ...PRESET_ENV_TABLES])];

            if (allTables.length > 0) {
                excludeTables = allTables;
                const presetCount = PRESET_ENV_TABLES.length;
                const dynamicCount = dynamicTables.length;
                const totalCount = excludeTables.length;
                console.log(`   ✓ 已动态获取 ${dynamicCount} 个业务表 + ${presetCount} 个预设环境数据表 = ${totalCount} 个排除表`);

                // 显示预设表信息
                if (presetCount > 0) {
                    console.log(`   📋 预设环境数据表:`);
                    PRESET_ENV_TABLES.forEach(table => console.log(`      - ${table}`));
                }
            } else {
                console.log(`   ⚠ 未找到业务表，将继续导出所有表（无排除）`);
            }
        }

        // 根据 DB_UNDERSCORED 配置转换排除表名（如果动态获取的表名需要转换）
        if (dbUnderscored !== undefined && excludeTables.length > 0) {
            console.log(`\n📝 DB_UNDERSCORED 配置: ${dbUnderscored}`);
            const originalTables = [...excludeTables];
            excludeTables = convertTableNames(excludeTables, dbUnderscored);

            // 显示转换信息
            let hasConversion = false;
            for (let i = 0; i < originalTables.length; i++) {
                if (originalTables[i] !== excludeTables[i]) {
                    if (!hasConversion) {
                        console.log('   表名转换:');
                        hasConversion = true;
                    }
                    console.log(`   ${originalTables[i]} -> ${excludeTables[i]}`);
                }
            }
            if (!hasConversion) {
                console.log('   (无需转换)');
            }
        }

        // 获取排除表的多对多关联表
        // 注意：需要传入原始表名（未转换的）来查询 collections 表
        const originalExcludeTables = dbUnderscored !== undefined
            ? convertTableNames(excludeTables, !dbUnderscored) // 反向转换回原始格式
            : excludeTables;

        const junctionTables = await getM2MJunctionTables(sourceConn, originalExcludeTables, dbUnderscored);

        // 将关联表合并到 excludeTables 列表
        if (junctionTables.length > 0) {
            const beforeCount = excludeTables.length;
            // 添加新的关联表（去重）
            const newTables = junctionTables.filter(t => !excludeTables.includes(t));
            excludeTables = [...excludeTables, ...newTables];
            console.log(`\n   ✓ 已将 ${newTables.length} 个多对多关联表添加到排除列表`);
            console.log(`   ✓ 排除业务表总数: ${beforeCount} -> ${excludeTables.length}`);
        }

        // 步骤 1: 获取所有的表，并过滤出配置表
        console.log(`\n[1/2] 计算需要导出的配置表...`);
        const { allTables, configTables } = await getConfigTables(sourceConn, excludeTables);
        console.log(`   数据库总表数: ${allTables.length}`);
        console.log(`   排除业务表数: ${excludeTables.length}`);
        console.log(`   需要导出数据的配置表数: ${configTables.length}`);

        // 关闭 source 连接
        await sourceConn.end();
        sourceConn = null;

        if (configTables.length === 0) {
            console.log(`   ⚠ 没有需要导出的配置表，任务结束。`);
            return;
        }

        // 步骤 2: 导出纯配置数据和覆盖脚本
        const header = generateSQLHeader(source, null, excludeTables);
        await exportConfigurationData(source, configTables, outputFile, header);
        console.log(`   ✓ 配置数据导出并生成覆盖补丁完成`);

        // 显示文件信息
        const stats = await fs.stat(outputFile);
        const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log('\n' + '='.repeat(60));
        console.log('✓ 导出完成！');
        console.log('='.repeat(60));
        console.log(`输出文件: ${outputFile}`);
        console.log(`文件大小: ${fileSizeInMB} MB`);
        console.log('\n使用方法:');
        console.log(`  mysql -u username -p target_database_name < ${outputFile}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n✗ 导出过程中发生错误:');
        console.error(error.message);
        process.exit(1);
    } finally {
        // 关闭数据库连接
        if (sourceConn) await sourceConn.end();
    }
}

// 从 Source 数据库动态获取业务数据表（从 collections 表）
async function getDynamicBusinessTables(connection, sourceConfig, dbUnderscored) {
    try {
        console.log('\n🔍 正在从 collections 表动态获取业务表列表...');

        // 检查 collections 表是否存在
        const [tableCheck] = await connection.query(
            "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'collections'",
            []
        );

        if (tableCheck[0].count === 0) {
            console.log('   ⚠ collections 表不存在，无法动态获取业务表列表');
            return [];
        }

        // 从 collections 表获取表名
        const [rows] = await connection.query(
            "SELECT name FROM collections WHERE name IS NOT NULL AND name != ''"
        );

        const tableNames = rows.map(row => row.name);
        console.log(`   ✓ 找到 ${tableNames.length} 个业务表`);

        // 验证这些表在数据库中是否真实存在（过滤虚拟表）
        const validTables = [];
        for (const tableName of tableNames) {
            const [check] = await connection.query(
                "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
                [tableName]
            );

            if (check[0].count > 0) {
                validTables.push(tableName);
            }
        }

        console.log(`   ✓ 验证后有效表数量: ${validTables.length} 个`);
        return validTables;

    } catch (error) {
        console.error(`   ✗ 动态获取业务表失败: ${error.message}`);
        return [];
    }
}

// 主函数
async function main() {
    const configPath = process.argv[2] || './config.json';

    console.log(`读取配置文件: ${configPath}\n`);
    const config = await loadConfig(configPath);

    await mergeExports(config);
}

// 导出函数供其他模块调用
module.exports = {
    mergeExports,
    loadConfig,
    createConnection,
    getConfigTables,
    getM2MJunctionTables
};

// 如果直接运行此文件，则执行主函数
if (require.main === module) {
    main().catch(error => {
        console.error('程序异常:', error);
        process.exit(1);
    });
}
