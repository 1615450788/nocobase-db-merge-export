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
    header += '-- NocoBase Database Merge Export Tool\n';
    header += '-- ============================================================\n';
    header += '--\n';
    header += `-- Export Time: ${timestamp}\n`;
    header += '--\n';
    header += '-- SOURCE DATABASE (Structure + Most Data):\n';
    header += `--   Host:     ${sourceConfig.host}:${sourceConfig.port}\n`;
    header += `--   Database: ${sourceConfig.database}\n`;
    header += `--   User:     ${sourceConfig.user}\n`;
    header += '--\n';
    header += '-- TARGET DATABASE (Data for Excluded Tables):\n';
    header += `--   Host:     ${targetConfig.host}:${targetConfig.port}\n`;
    header += `--   Database: ${targetConfig.database}\n`;
    header += `--   User:     ${targetConfig.user}\n`;
    header += '--\n';
    if (excludeTables && excludeTables.length > 0) {
        header += '-- EXCLUDED TABLES (Data from TARGET):\n';
        excludeTables.forEach(table => {
            header += `--   - ${table}\n`;
        });
    } else {
        header += '-- EXCLUDED TABLES: None\n';
    }
    header += '--\n';
    header += '-- USAGE:\n';
    header += '--   mysql -u username -p database_name < this_file.sql\n';
    header += '--\n';
    header += '-- ============================================================\n';
    header += '\n';
    // 添加MySQL兼容的字符集设置，防止乱码
    header += 'SET NAMES utf8mb4;\n';
    header += '/*!40101 SET NAMES utf8mb4 */;\n\n';
    return header;
}

// 使用 mysqldump 导出数据库结构（排除指定表的数据）
async function exportStructure(sourceConfig, targetConfig, excludeTables, outputFile) {
    return new Promise((resolve, reject) => {
        console.log(`\n[1/4] 从 source 数据库导出结构...`);

        const config = sourceConfig;

        const args = [
            '-h', config.host,
            '-P', config.port.toString(),
            '-u', config.user,
            '--single-transaction',
            '--skip-lock-tables',
            '--skip-add-locks',
            '--hex-blob',
            '--routines',
            '--triggers',
            '--events',
            '--complete-insert',
            '--default-character-set=utf8mb4',
            config.database
        ];

        // 使用环境变量传递密码（避免命令行参数中的特殊字符问题）
        const env = { ...process.env };
        if (config.password) {
            env.MYSQL_PWD = config.password;
        }

        // 排除指定表的数据（但保留结构）
        if (excludeTables && excludeTables.length > 0) {
            console.log(`   排除数据的表: ${excludeTables.join(', ')}`);
            // 先导出所有表结构
            const structArgs = [...args, '--no-data'];

            // 然后导出非排除表的数据
            const dataArgs = [...args, '--no-create-info'];
            excludeTables.forEach(table => {
                dataArgs.push(`--ignore-table=${config.database}.${table}`);
            });
            // 保证数据导出也加上字符集
            structArgs.push('--default-character-set=utf8mb4');
            dataArgs.push('--default-character-set=utf8mb4');

            // 先导出结构
            const dumpStructure = spawn('mysqldump', structArgs, { env });
            const dumpData = spawn('mysqldump', dataArgs, { env });

            // 设置流编码为 utf8
            dumpStructure.stdout.setEncoding('utf8');
            dumpStructure.stderr.setEncoding('utf8');

            let structureOutput = '';
            let dataOutput = '';
            let errors = '';

            dumpStructure.stdout.on('data', (data) => {
                structureOutput += data;
            });

            dumpStructure.stderr.on('data', (data) => {
                errors += data;
            });

            dumpStructure.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`mysqldump 导出结构失败: ${errors}`));
                    return;
                }

                // 导出数据
                dumpData.stdout.setEncoding('utf8');
                dumpData.stderr.setEncoding('utf8');

                dumpData.stdout.on('data', (data) => {
                    dataOutput += data;
                });

                dumpData.stderr.on('data', (data) => {
                    errors += data;
                });

                dumpData.on('close', async (code) => {
                    if (code !== 0) {
                        reject(new Error(`mysqldump 导出数据失败: ${errors}`));
                        return;
                    }

                    try {
                        // 生成头部注释
                        const header = generateSQLHeader(sourceConfig, targetConfig, excludeTables);

                        // 合并头部、结构和数据
                        const combinedOutput = header + structureOutput + '\n' + dataOutput;
                        await fs.writeFile(outputFile, combinedOutput, 'utf8');
                        console.log(`   ✓ 结构导出完成`);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });

                dumpData.on('error', (error) => {
                    reject(new Error(`执行 mysqldump 失败: ${error.message}`));
                });
            });

            dumpStructure.on('error', (error) => {
                reject(new Error(`执行 mysqldump 失败: ${error.message}`));
            });
        } else {
            // 没有排除表，直接导出全部
            const dumpProcess = spawn('mysqldump', args, { env });

            // 设置流编码为 utf8
            dumpProcess.stdout.setEncoding('utf8');
            dumpProcess.stderr.setEncoding('utf8');

            let output = '';
            let errors = '';

            dumpProcess.stdout.on('data', (data) => {
                output += data;
            });

            dumpProcess.stderr.on('data', (data) => {
                errors += data;
            });

            dumpProcess.on('close', async (code) => {
                if (code !== 0) {
                    reject(new Error(`mysqldump 失败: ${errors}`));
                    return;
                }

                try {
                    // 生成头部注释
                    const header = generateSQLHeader(sourceConfig, targetConfig, excludeTables);

                    // 合并头部和输出
                    const finalOutput = header + output;
                    await fs.writeFile(outputFile, finalOutput, 'utf8');
                    console.log(`   ✓ 完整导出完成`);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            dumpProcess.on('error', (error) => {
                reject(new Error(`执行 mysqldump 失败: ${error.message}`));
            });
        }
    });
}

// 获取两个数据库表的共有列
async function getCommonColumns(sourceConn, targetConn, sourceDb, targetDb, tableName) {
    // 获取 Source 表的列名
    const [sourceColumns] = await sourceConn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [sourceDb, tableName]
    );

    const sourceColumnNames = sourceColumns.map(row => row.COLUMN_NAME);

    // 获取 Target 表的列名
    const [targetColumns] = await targetConn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [targetDb, tableName]
    );

    const targetColumnNames = targetColumns.map(row => row.COLUMN_NAME);

    // 取交集
    const commonColumns = sourceColumnNames.filter(col => targetColumnNames.includes(col));
    const sourceOnly = sourceColumnNames.filter(col => !targetColumnNames.includes(col));
    const targetOnly = targetColumnNames.filter(col => !sourceColumnNames.includes(col));

    return {
        commonColumns,
        sourceColumnNames,
        targetColumnNames,
        sourceOnly,
        targetOnly
    };
}

// 使用 mysqldump 从 target 数据库导出指定表的数据（支持列对比，只导出共有字段）
async function exportTargetTablesData(targetConfig, sourceConfig, tables, outputFile) {
    if (!tables || tables.length === 0) {
        return;
    }

    let sourceConn = null;
    let targetConn = null;

    try {
        // 连接数据库
        sourceConn = await createConnection(sourceConfig);
        targetConn = await createConnection(targetConfig);

        // 添加注释头
        let targetDataSQL = '\n\n';
        targetDataSQL += '-- ' + '='.repeat(58) + '\n';
        targetDataSQL += '-- Data from target database for excluded tables\n';
        targetDataSQL += '-- Only common columns between source and target are exported\n';
        targetDataSQL += '-- ' + '='.repeat(58) + '\n\n';

        // 逐表处理
        for (const tableName of tables) {
            console.log(`   处理表: ${tableName}`);

            // 获取列信息
            const columnInfo = await getCommonColumns(
                sourceConn,
                targetConn,
                sourceConfig.database,
                targetConfig.database,
                tableName
            );

            if (columnInfo.sourceColumnNames.length === 0) {
                console.log(`      ⚠ 表 ${tableName} 在 source 中不存在，跳过`);
                targetDataSQL += `-- Table ${tableName} not found in source database\n\n`;
                continue;
            }

            if (columnInfo.targetColumnNames.length === 0) {
                console.log(`      ⚠ 表 ${tableName} 在 target 中不存在，跳过`);
                targetDataSQL += `-- Table ${tableName} not found in target database\n\n`;
                continue;
            }

            if (columnInfo.commonColumns.length === 0) {
                console.log(`      ⚠ 表 ${tableName} 没有公共列，跳过`);
                targetDataSQL += `-- Table ${tableName} has no common columns\n\n`;
                continue;
            }

            // 输出列差异信息
            if (columnInfo.sourceOnly.length > 0 || columnInfo.targetOnly.length > 0) {
                console.log(`      ⚠ 列差异：`);
                if (columnInfo.sourceOnly.length > 0) {
                    console.log(`        Source独有: ${columnInfo.sourceOnly.join(', ')}`);
                }
                if (columnInfo.targetOnly.length > 0) {
                    console.log(`        Target独有: ${columnInfo.targetOnly.join(', ')}`);
                }
                console.log(`        公共列: ${columnInfo.commonColumns.length} 个`);
            }

            // 添加表注释
            targetDataSQL += `--\n-- Dumping data for table \`${tableName}\`\n--\n`;
            targetDataSQL += `-- Common columns: ${columnInfo.commonColumns.length} `;
            targetDataSQL += `(Source: ${columnInfo.sourceColumnNames.length}, Target: ${columnInfo.targetColumnNames.length})\n`;

            if (columnInfo.sourceOnly.length > 0) {
                targetDataSQL += `-- Source-only columns (will use default/NULL): ${columnInfo.sourceOnly.join(', ')}\n`;
            }
            if (columnInfo.targetOnly.length > 0) {
                targetDataSQL += `-- Target-only columns (ignored): ${columnInfo.targetOnly.join(', ')}\n`;
            }
            targetDataSQL += `--\n\n`;

            // 如果没有列差异，直接用 mysqldump 导出
            if (columnInfo.targetOnly.length === 0) {
                console.log(`      ✓ 无列差异，使用 mysqldump 直接导出`);

                const dumpOutput = await new Promise((resolve, reject) => {
                    const args = [
                        '-h', targetConfig.host,
                        '-P', targetConfig.port.toString(),
                        '-u', targetConfig.user,
                        '--single-transaction',
                        '--skip-lock-tables',
                        '--skip-add-locks',
                        '--hex-blob',
                        '--no-create-info',
                        '--complete-insert',
                        '--skip-triggers',
                        '--default-character-set=utf8mb4',
                        targetConfig.database,
                        tableName
                    ];

                    const env = { ...process.env };
                    if (targetConfig.password) {
                        env.MYSQL_PWD = targetConfig.password;
                    }

                    const dumpProcess = spawn('mysqldump', args, { env });

                    dumpProcess.stdout.setEncoding('utf8');
                    dumpProcess.stderr.setEncoding('utf8');

                    let output = '';
                    let errors = '';

                    dumpProcess.stdout.on('data', (data) => {
                        output += data;
                    });

                    dumpProcess.stderr.on('data', (data) => {
                        errors += data;
                    });

                    dumpProcess.on('close', (code) => {
                        if (code !== 0) {
                            reject(new Error(`mysqldump failed: ${errors}`));
                        } else {
                            resolve(output);
                        }
                    });

                    dumpProcess.on('error', (error) => {
                        reject(new Error(`Failed to execute mysqldump: ${error.message}`));
                    });
                });

                // 添加 DELETE 语句
                targetDataSQL += `DELETE FROM \`${tableName}\`;\n`;
                targetDataSQL += dumpOutput;
                targetDataSQL += '\n';

            } else {
                // 有列差异，使用 mysqldump --where 配合临时表
                console.log(`      ⚠ 有列差异，使用临时表方式导出`);

                const tempTableName = `_dbm_temp_${tableName}`;
                const columnList = columnInfo.commonColumns.map(col => mysql.escapeId(col)).join(', ');

                try {
                    // 删除可能存在的旧临时表
                    await targetConn.query(`DROP TABLE IF EXISTS ${mysql.escapeId(tempTableName)}`);

                    // 创建临时表（只包含共有列的数据）
                    await targetConn.query(
                        `CREATE TABLE ${mysql.escapeId(tempTableName)} AS SELECT ${columnList} FROM ${mysql.escapeId(tableName)}`
                    );

                    console.log(`      ✓ 创建临时表成功`);

                    // 使用 mysqldump 导出临时表数据
                    const dumpOutput = await new Promise((resolve, reject) => {
                        const args = [
                            '-h', targetConfig.host,
                            '-P', targetConfig.port.toString(),
                            '-u', targetConfig.user,
                            '--single-transaction',
                            '--skip-lock-tables',
                            '--skip-add-locks',
                            '--hex-blob',
                            '--no-create-info',
                            '--complete-insert',
                            '--skip-triggers',
                            '--default-character-set=utf8mb4',
                            targetConfig.database,
                            tempTableName
                        ];

                        const env = { ...process.env };
                        if (targetConfig.password) {
                            env.MYSQL_PWD = targetConfig.password;
                        }

                        const dumpProcess = spawn('mysqldump', args, { env });

                        dumpProcess.stdout.setEncoding('utf8');
                        dumpProcess.stderr.setEncoding('utf8');

                        let output = '';
                        let errors = '';

                        dumpProcess.stdout.on('data', (data) => {
                            output += data;
                        });

                        dumpProcess.stderr.on('data', (data) => {
                            errors += data;
                        });

                        dumpProcess.on('close', (code) => {
                            if (code !== 0) {
                                reject(new Error(`mysqldump failed: ${errors}`));
                            } else {
                                resolve(output);
                            }
                        });

                        dumpProcess.on('error', (error) => {
                            reject(new Error(`Failed to execute mysqldump: ${error.message}`));
                        });
                    });

                    console.log(`      ✓ mysqldump 导出成功`);

                    // 将临时表名替换为实际表名
                    const processedOutput = dumpOutput.replace(
                        new RegExp(`\`${tempTableName}\``, 'g'),
                        `\`${tableName}\``
                    );

                    // 添加 DELETE 语句
                    targetDataSQL += `DELETE FROM \`${tableName}\`;\n`;
                    targetDataSQL += processedOutput;
                    targetDataSQL += '\n';

                } finally {
                    // 清理临时表
                    try {
                        await targetConn.query(`DROP TABLE IF EXISTS ${mysql.escapeId(tempTableName)}`);
                        console.log(`      ✓ 清理临时表成功`);
                    } catch (e) {
                        console.log(`      ⚠ 清理临时表失败: ${e.message}`);
                    }
                }
            }

            console.log(`      ✓ 导出完成 (${columnInfo.commonColumns.length} 列)`);
        }

        // 追加到输出文件
        await fs.appendFile(outputFile, targetDataSQL, 'utf8');

    } catch (error) {
        console.error(`\n✗ 导出排除表数据失败: ${error.message}`);
        throw error;
    } finally {
        if (sourceConn) await sourceConn.end();
        if (targetConn) await targetConn.end();
    }
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
    const { source, target, export: exportConfig } = config;
    let { excludeTables, outputFile, dbUnderscored } = exportConfig;

    // 自动为输出文件添加时间戳（如果还没有）
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');

    // 检查文件名中是否已有时间戳模式（8位数字_6位数字）
    if (!/\d{8}_\d{6}/.test(outputFile)) {
        // 在 .sql 前插入时间戳
        outputFile = outputFile.replace(/\.sql$/, `_${timestamp}.sql`);
    }

    // 根据 DB_UNDERSCORED 配置转换排除表名
    if (dbUnderscored !== undefined) {
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

    // 对排除表列表去重
    const originalCount = excludeTables.length;
    excludeTables = [...new Set(excludeTables)];
    const duplicateCount = originalCount - excludeTables.length;

    console.log('='.repeat(60));
    console.log('NocoBase 数据库导出合并工具');
    console.log('='.repeat(60));
    console.log(`Source 数据库: ${source.database}`);
    console.log(`Target 数据库: ${target.database}`);
    console.log(`输出文件: ${outputFile}`);
    if (dbUnderscored !== undefined) {
        console.log(`DB_UNDERSCORED: ${dbUnderscored ? '启用' : '禁用'}`);
    }
    if (duplicateCount > 0) {
        console.log(`⚠ 检测到 ${duplicateCount} 个重复表名已自动去重`);
    }
    console.log('='.repeat(60));

    let sourceConn = null;
    let targetConn = null;

    try {
        // 步骤 0: 连接 source 数据库，获取多对多关联表
        console.log(`\n[0/4] 连接 source 数据库，查询多对多关联表...`);
        sourceConn = await createConnection(source);
        console.log(`   ✓ 连接成功`);

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
            console.log(`   ✓ 排除表总数: ${beforeCount} -> ${excludeTables.length}`);
        }

        // 关闭 source 连接，稍后会重新连接
        await sourceConn.end();
        sourceConn = null;

        // 步骤 1: 导出 source 数据库结构和非排除表的数据
        await exportStructure(source, target, excludeTables, outputFile);

        // 步骤 2: 连接 target 数据库
        console.log(`\n[2/4] 连接 target 数据库...`);
        targetConn = await createConnection(target);
        console.log(`   ✓ 连接成功`);

        // 步骤 3: 验证并过滤排除的表（只保留两个数据库都存在的表）
        console.log(`\n[3/4] 验证并过滤 excludeTables...`);

        // 连接 source 数据库
        sourceConn = await createConnection(source);

        const validTables = [];
        const sourceOnlyTables = [];
        const targetOnlyTables = [];

        for (const table of excludeTables) {
            // 检查表在 target 中是否存在
            const [targetRows] = await targetConn.query(
                'SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
                [target.database, table]
            );

            // 检查表在 source 中是否存在
            const [sourceRows] = await sourceConn.query(
                'SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
                [source.database, table]
            );

            const existsInTarget = targetRows[0].count > 0;
            const existsInSource = sourceRows[0].count > 0;

            if (existsInTarget && existsInSource) {
                const [countRows] = await targetConn.query(`SELECT COUNT(*) as count FROM ${mysql.escapeId(table)}`);
                console.log(`   ✓ 表 ${table} 在两个数据库都存在 (${countRows[0].count} 行)`);
                validTables.push(table);
            } else if (!existsInTarget) {
                console.log(`   ⚠ 跳过表 ${table}: target 中不存在`);
                targetOnlyTables.push(table);
            } else if (!existsInSource) {
                console.log(`   ⚠ 跳过表 ${table}: source 中不存在 (无法导入)`);
                sourceOnlyTables.push(table);
            }
        }

        if (validTables.length === 0) {
            console.log(`   ⚠ 没有需要从 target 导出的表`);
        }

        // 更新 excludeTables 为只包含有效的表
        excludeTables = validTables;

        // 关闭之前的连接
        await sourceConn.end();
        await targetConn.end();
        sourceConn = null;
        targetConn = null;

        // 步骤 4: 从 target 数据库导出排除表的数据
        console.log(`\n[4/4] 从 target 数据库导出排除表的数据...`);

        await exportTargetTablesData(target, source, excludeTables, outputFile);
        console.log(`   ✓ 数据追加完成`);

        // 显示文件信息
        const stats = await fs.stat(outputFile);
        const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log('\n' + '='.repeat(60));
        console.log('✓ 导出完成！');
        console.log('='.repeat(60));
        console.log(`输出文件: ${outputFile}`);
        console.log(`文件大小: ${fileSizeInMB} MB`);
        console.log('\n使用方法:');
        console.log(`  mysql -u username -p database_name < ${outputFile}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n✗ 导出过程中发生错误:');
        console.error(error.message);
        process.exit(1);
    } finally {
        // 关闭数据库连接
        if (sourceConn) await sourceConn.end();
        if (targetConn) await targetConn.end();
    }
}

// 主函数
async function main() {
    const configPath = process.argv[2] || './config.json';

    console.log(`读取配置文件: ${configPath}\n`);
    const config = await loadConfig(configPath);

    await mergeExports(config);
}

// 运行主函数
main().catch(error => {
    console.error('程序异常:', error);
    process.exit(1);
});
