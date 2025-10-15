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
            '--routines',
            '--triggers',
            '--events',
            config.database
        ];

        // 添加密码参数
        if (config.password) {
            args.splice(5, 0, `-p${config.password}`);
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

            // 先导出结构
            const dumpStructure = spawn('mysqldump', structArgs);
            const dumpData = spawn('mysqldump', dataArgs);

            let structureOutput = '';
            let dataOutput = '';
            let errors = '';

            dumpStructure.stdout.on('data', (data) => {
                structureOutput += data.toString();
            });

            dumpStructure.stderr.on('data', (data) => {
                errors += data.toString();
            });

            dumpStructure.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`mysqldump 导出结构失败: ${errors}`));
                    return;
                }

                // 导出数据
                dumpData.stdout.on('data', (data) => {
                    dataOutput += data.toString();
                });

                dumpData.stderr.on('data', (data) => {
                    errors += data.toString();
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
            const dumpProcess = spawn('mysqldump', args);
            let output = '';
            let errors = '';

            dumpProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            dumpProcess.stderr.on('data', (data) => {
                errors += data.toString();
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

// 从 source 和 target 数据库导出表数据（匹配列）
async function exportTableDataWithReplace(targetConfig, sourceConfig, tableName) {
    try {
        // 连接到 Source 和 Target 数据库
        const sourceConn = await createConnection(sourceConfig);
        const targetConn = await createConnection(targetConfig);

        try {
            // 获取 Source 表的列名
            const [sourceColumns] = await sourceConn.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                 ORDER BY ORDINAL_POSITION`,
                [sourceConfig.database, tableName]
            );

            const sourceColumnNames = sourceColumns.map(row => row.COLUMN_NAME);

            if (sourceColumnNames.length === 0) {
                return `-- Table ${tableName} not found in source database\n\n`;
            }

            // 获取 Target 表的列名
            const [targetColumns] = await targetConn.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                 ORDER BY ORDINAL_POSITION`,
                [targetConfig.database, tableName]
            );

            const targetColumnNames = targetColumns.map(row => row.COLUMN_NAME);

            if (targetColumnNames.length === 0) {
                return `-- Table ${tableName} not found in target database\n\n`;
            }

            // 取交集：只选择两个数据库都存在的列
            const columnNames = sourceColumnNames.filter(col => targetColumnNames.includes(col));

            if (columnNames.length === 0) {
                console.log(`      ⚠ 表 ${tableName} 没有公共列，跳过`);
                return `-- Table ${tableName} has no common columns between source and target\n\n`;
            }

            // 如果有列差异，输出警告
            const sourceOnly = sourceColumnNames.filter(col => !targetColumnNames.includes(col));
            const targetOnly = targetColumnNames.filter(col => !sourceColumnNames.includes(col));

            if (sourceOnly.length > 0 || targetOnly.length > 0) {
                console.log(`      ⚠ 表 ${tableName} 列差异：`);
                if (sourceOnly.length > 0) {
                    console.log(`        Source独有: ${sourceOnly.join(', ')}`);
                }
                if (targetOnly.length > 0) {
                    console.log(`        Target独有: ${targetOnly.join(', ')}`);
                }
                console.log(`        使用公共列: ${columnNames.length} 个`);
            }

            // 从 Target 数据库查询数据，只选择公共列
            const columnList = columnNames.map(col => mysql.escapeId(col)).join(', ');
            const [rows] = await targetConn.query(`SELECT ${columnList} FROM ${mysql.escapeId(tableName)}`);

            if (rows.length === 0) {
                return `-- Table ${tableName} is empty in target database\n\n`;
            }

            // 生成 REPLACE INTO 语句
            let result = '';
            result += `--\n-- Dumping data for table \`${tableName}\` from target database\n--\n`;
            result += `-- Common columns: ${columnNames.length} (Source: ${sourceColumnNames.length}, Target: ${targetColumnNames.length})\n`;

            if (sourceOnly.length > 0) {
                result += `-- Source-only columns (will use default/NULL): ${sourceOnly.join(', ')}\n`;
            }
            if (targetOnly.length > 0) {
                result += `-- Target-only columns (ignored): ${targetOnly.join(', ')}\n`;
            }
            result += `--\n\n`;

            const escapedColumnNames = columnNames.map(col => mysql.escapeId(col)).join(', ');

            // 分批生成 INSERT（避免过大的语句）
            const batchSize = 100;
            for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);

                const values = batch.map(row => {
                    const rowValues = columnNames.map(col => {
                        const value = row[col];
                        if (value === null) return 'NULL';
                        if (value instanceof Date) return mysql.escape(value);
                        if (Buffer.isBuffer(value)) return mysql.escape(value);
                        if (typeof value === 'number') return value;
                        // 字符串类型（包括BIGINT字符串）和其他类型都用 escape
                        return mysql.escape(value);
                    });
                    return `(${rowValues.join(',')})`;
                }).join(',\n');

                result += `REPLACE INTO \`${tableName}\` (${escapedColumnNames}) VALUES\n${values};\n\n`;
            }

            return result;

        } finally {
            await sourceConn.end();
            await targetConn.end();
        }

    } catch (error) {
        console.error(`      ✗ 导出表 ${tableName} 失败: ${error.message}`);
        return `-- Error exporting table ${tableName}: ${error.message}\n\n`;
    }
}

// 合并导出的 SQL
async function mergeExports(config) {
    const { source, target, export: exportConfig } = config;
    let { excludeTables, outputFile } = exportConfig;

    // 自动为输出文件添加时间戳（如果还没有）
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');

    // 检查文件名中是否已有时间戳模式（8位数字_6位数字）
    if (!/\d{8}_\d{6}/.test(outputFile)) {
        // 在 .sql 前插入时间戳
        outputFile = outputFile.replace(/\.sql$/, `_${timestamp}.sql`);
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
    if (duplicateCount > 0) {
        console.log(`⚠ 检测到 ${duplicateCount} 个重复表名已自动去重`);
    }
    console.log('='.repeat(60));

    let sourceConn = null;
    let targetConn = null;

    try {
        // 步骤 1: 导出 source 数据库结构和非排除表的数据
        await exportStructure(source, target, excludeTables, outputFile);

        // 步骤 2: 连接 target 数据库
        console.log(`\n[2/4] 连接 target 数据库...`);
        targetConn = await createConnection(target);
        console.log(`   ✓ 连接成功`);

        // 步骤 3: 验证排除的表在 target 数据库中存在
        console.log(`\n[3/4] 验证 target 数据库中的表...`);
        for (const table of excludeTables) {
            const [rows] = await targetConn.query(
                'SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
                [target.database, table]
            );

            if (rows[0].count === 0) {
                console.log(`   ⚠ 警告: 表 ${table} 在 target 数据库中不存在`);
            } else {
                const [countRows] = await targetConn.query(`SELECT COUNT(*) as count FROM ${mysql.escapeId(table)}`);
                console.log(`   ✓ 表 ${table} 存在 (${countRows[0].count} 行)`);
            }
        }

        // 步骤 4: 从 target 数据库导出排除表的数据（使用 REPLACE INTO 去重）
        console.log(`\n[4/4] 从 target 数据库导出排除表的数据...`);

        let targetDataSQL = '\n\n';
        targetDataSQL += '-- ' + '='.repeat(58) + '\n';
        targetDataSQL += '-- Data from target database for excluded tables\n';
        targetDataSQL += '-- Using REPLACE INTO to handle duplicates\n';
        targetDataSQL += '-- ' + '='.repeat(58) + '\n\n';

        for (const table of excludeTables) {
            console.log(`   处理表: ${table}...`);

            // 先清空表数据，然后使用 REPLACE INTO 导入
            targetDataSQL += `-- Clear and replace data for table ${table}\n`;
            targetDataSQL += `DELETE FROM \`${table}\`;\n\n`;

            const tableData = await exportTableDataWithReplace(target, source, table);
            targetDataSQL += tableData;
        }

        // 追加到输出文件
        await fs.appendFile(outputFile, targetDataSQL, 'utf8');
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