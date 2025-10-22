#!/usr/bin/env node

/**
 * DBM - Database Merge Export Tool
 * 全局命令行工具入口
 */

const path = require('path');
const fs = require('fs');
const inquirer = require('inquirer');
const mysql = require('mysql2/promise');

// 获取命令行参数
const args = process.argv.slice(2);

// 预设表组合
const PRESET_TABLES = {
    approval: [
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
        "notification_send_logs"
    ]
};

// 获取表的多对多关联表（junction tables）
async function getM2MJunctionTables(connection, tableNames) {
    try {
        const junctionTables = [];

        // 检查 fields 表是否存在
        const [tableCheck] = await connection.query(
            "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'fields'",
            []
        );

        if (tableCheck[0].count === 0) {
            return junctionTables;
        }

        // 查询多对多字段
        const placeholders = tableNames.map(() => '?').join(',');
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

        const [fields] = await connection.query(query, tableNames);

        // 解析 options JSON 获取 through 属性
        for (const field of fields) {
            try {
                const options = typeof field.options === 'string'
                    ? JSON.parse(field.options)
                    : field.options;

                if (options && options.through) {
                    junctionTables.push(options.through);
                }
            } catch (error) {
                // 忽略解析错误
            }
        }

        // 去重
        return [...new Set(junctionTables)];

    } catch (error) {
        return [];
    }
}

// 从 Source 数据库获取业务数据表（从 collections 表）
async function getBusinessTables(sourceConfig, includeJunctionTables = true) {
    let connection;
    try {
        console.log('\n🔍 正在连接 Source 数据库获取业务表列表...');

        connection = await mysql.createConnection({
            host: sourceConfig.host,
            port: sourceConfig.port,
            user: sourceConfig.user,
            password: sourceConfig.password,
            database: sourceConfig.database
        });

        // 检查 collections 表是否存在
        const [tableCheck] = await connection.query(
            "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = 'collections'",
            [sourceConfig.database]
        );

        if (tableCheck[0].count === 0) {
            console.log('   ⚠ collections 表不存在，无法获取业务表列表');
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
                "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
                [sourceConfig.database, tableName]
            );

            if (check[0].count > 0) {
                validTables.push(tableName);
            }
        }

        console.log(`   ✓ 验证后有效表数量: ${validTables.length} 个`);

        // 获取多对多关联表
        if (includeJunctionTables && validTables.length > 0) {
            const junctionTables = await getM2MJunctionTables(connection, validTables);
            if (junctionTables.length > 0) {
                console.log(`   ✓ 找到 ${junctionTables.length} 个多对多关联表`);
                // 合并并去重
                const newTables = junctionTables.filter(t => !validTables.includes(t));
                return [...validTables, ...newTables];
            }
        }

        return validTables;

    } catch (error) {
        console.error(`   ✗ 获取业务表失败: ${error.message}`);
        return [];
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// 显示帮助信息
function showHelp() {
    console.log(`
DBM - Database Merge Export Tool
用于 NocoBase 应用版本升级时的数据库导出合并工具

用法:
  dbm [配置文件]                    使用指定配置文件导出
  dbm                              使用当前目录的 config.json
  dbm --help, -h                   显示此帮助信息
  dbm --version, -v                显示版本信息
  dbm --init                       交互式生成配置文件

示例:
  dbm                              # 使用 ./config.json
  dbm ./my-config.json             # 使用自定义配置
  dbm --init                       # 交互式生成 config.json

配置文件格式:
  {
    "source": {
      "host": "127.0.0.1",
      "port": 3306,
      "user": "root",
      "password": "password",
      "database": "source_db"
    },
    "target": {
      "host": "127.0.0.1",
      "port": 3306,
      "user": "root",
      "password": "password",
      "database": "target_db"
    },
    "export": {
      "excludeTables": ["users", "roles"],
      "outputFile": "./merged_export.sql"
    }
  }
`);
}

// 显示版本信息
function showVersion() {
    const packageJson = require('../package.json');
    console.log(`dbm version ${packageJson.version}`);
}

// 交互式生成配置文件
async function initConfig() {
    const configPath = path.join(process.cwd(), 'config.json');

    if (fs.existsSync(configPath)) {
        const { overwrite } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'overwrite',
                message: 'config.json 已存在，是否覆盖？',
                default: false
            }
        ]);

        if (!overwrite) {
            console.log('操作已取消');
            process.exit(0);
        }
    }

    console.log('\n🔧 配置数据库导出工具\n');

    // Source 数据库配置
    console.log('📦 Source 数据库配置（导出结构和大部分数据）:\n');
    const sourceAnswers = await inquirer.prompt([
        {
            type: 'input',
            name: 'host',
            message: 'Source 数据库主机:',
            default: '127.0.0.1'
        },
        {
            type: 'number',
            name: 'port',
            message: 'Source 数据库端口:',
            default: 3306
        },
        {
            type: 'input',
            name: 'user',
            message: 'Source 数据库用户名:',
            default: 'root'
        },
        {
            type: 'password',
            name: 'password',
            message: 'Source 数据库密码:',
            mask: '*'
        },
        {
            type: 'input',
            name: 'database',
            message: 'Source 数据库名:',
            validate: (input) => input.trim() !== '' || '数据库名不能为空'
        }
    ]);

    // Target 数据库配置
    console.log('\n📦 Target 数据库配置（提供排除表的数据）:\n');

    const { sameAsSource } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'sameAsSource',
            message: 'Target 数据库连接信息是否与 Source 相同？',
            default: false
        }
    ]);

    let targetAnswers;
    if (sameAsSource) {
        const { targetDatabase } = await inquirer.prompt([
            {
                type: 'input',
                name: 'targetDatabase',
                message: 'Target 数据库名:',
                validate: (input) => input.trim() !== '' || '数据库名不能为空'
            }
        ]);

        targetAnswers = {
            host: sourceAnswers.host,
            port: sourceAnswers.port,
            user: sourceAnswers.user,
            password: sourceAnswers.password,
            database: targetDatabase
        };
    } else {
        targetAnswers = await inquirer.prompt([
            {
                type: 'input',
                name: 'host',
                message: 'Target 数据库主机:',
                default: '127.0.0.1'
            },
            {
                type: 'number',
                name: 'port',
                message: 'Target 数据库端口:',
                default: 3306
            },
            {
                type: 'input',
                name: 'user',
                message: 'Target 数据库用户名:',
                default: 'root'
            },
            {
                type: 'password',
                name: 'password',
                message: 'Target 数据库密码:',
                mask: '*'
            },
            {
                type: 'input',
                name: 'database',
                message: 'Target 数据库名:',
                validate: (input) => input.trim() !== '' || '数据库名不能为空'
            }
        ]);
    }

    // 导出配置
    console.log('\n⚙️  导出配置:\n');

    // 选择预设表组合
    const { presetChoice } = await inquirer.prompt([
        {
            type: 'list',
            name: 'presetChoice',
            message: '选择排除表组合（这些表的数据将从 Target 数据库获取）:',
            choices: [
                { name: '组合1: 环境数据（工作流、变量、认证表等）', value: 'approval' },
                { name: '组合2: 业务数据（从 collections 表获取）', value: 'business' },
                { name: '组合3: 全部数据（环境数据 + 业务数据）', value: 'all' },
                { name: '自定义（手动输入）', value: 'custom' }
            ],
            default: 'approval'
        }
    ]);

    let excludeTables = [];

    if (presetChoice === 'approval') {
        excludeTables = PRESET_TABLES.approval;
        console.log(`   ✓ 已选择审批数据组合 (${excludeTables.length} 个表)`);
        excludeTables.forEach(t => console.log(`      - ${t}`));

        // 获取审批表的多对多关联表
        let connection;
        try {
            connection = await mysql.createConnection({
                host: sourceAnswers.host,
                port: sourceAnswers.port,
                user: sourceAnswers.user,
                password: sourceAnswers.password,
                database: sourceAnswers.database
            });

            const junctionTables = await getM2MJunctionTables(connection, excludeTables);
            if (junctionTables.length > 0) {
                console.log(`   ✓ 找到 ${junctionTables.length} 个审批相关的多对多关联表`);
                junctionTables.forEach(t => console.log(`      - ${t}`));
                const newTables = junctionTables.filter(t => !excludeTables.includes(t));
                excludeTables = [...excludeTables, ...newTables];
                console.log(`   ✓ 总计: ${excludeTables.length} 个表`);
            }
        } catch (error) {
            console.log(`   ⚠ 获取关联表失败: ${error.message}`);
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    } else if (presetChoice === 'business') {
        const businessTables = await getBusinessTables(sourceAnswers);
        if (businessTables.length === 0) {
            console.log('   ⚠ 未找到业务表，将使用空列表');
        }
        excludeTables = businessTables;
    } else if (presetChoice === 'all') {
        console.log('   📋 组合3: 合并审批数据 + 业务数据 + 多对多关联表');

        // 先添加审批数据
        console.log(`   ✓ 审批数据 (${PRESET_TABLES.approval.length} 个表)`);
        excludeTables = [...PRESET_TABLES.approval];

        // 再添加业务数据（已包含多对多关联表）
        const businessTables = await getBusinessTables(sourceAnswers, true);
        if (businessTables.length > 0) {
            // 去重合并（避免重复表名）
            const uniqueBusinessTables = businessTables.filter(t => !excludeTables.includes(t));
            excludeTables = [...excludeTables, ...uniqueBusinessTables];
            console.log(`   ✓ 业务数据及其关联表 (${uniqueBusinessTables.length} 个新表)`);
        } else {
            console.log('   ⚠ 未找到业务表');
        }

        // 获取审批表的多对多关联表
        let connection;
        try {
            connection = await mysql.createConnection({
                host: sourceAnswers.host,
                port: sourceAnswers.port,
                user: sourceAnswers.user,
                password: sourceAnswers.password,
                database: sourceAnswers.database
            });

            const approvalJunctionTables = await getM2MJunctionTables(connection, PRESET_TABLES.approval);
            if (approvalJunctionTables.length > 0) {
                const newTables = approvalJunctionTables.filter(t => !excludeTables.includes(t));
                if (newTables.length > 0) {
                    excludeTables = [...excludeTables, ...newTables];
                    console.log(`   ✓ 审批相关的多对多关联表 (${newTables.length} 个新表)`);
                }
            }
        } catch (error) {
            console.log(`   ⚠ 获取审批关联表失败: ${error.message}`);
        } finally {
            if (connection) {
                await connection.end();
            }
        }

        console.log(`   ✓ 总计: ${excludeTables.length} 个表`);
    } else {
        // 自定义输入
        const { customTables } = await inquirer.prompt([
            {
                type: 'input',
                name: 'customTables',
                message: '排除的表（从 Target 获取数据），用逗号分隔:',
                default: 'workflow_cc_tasks,user_workflow_tasks,approval_records,approval_executions,jobs,executions,approvals,workflow_stats',
                filter: (input) => {
                    return input.split(',').map(t => t.trim()).filter(t => t);
                }
            }
        ]);
        excludeTables = customTables;
    }

    // 询问 DB_UNDERSCORED 配置
    const { dbUnderscored } = await inquirer.prompt([
        {
            type: 'list',
            name: 'dbUnderscored',
            message: 'NocoBase DB_UNDERSCORED 配置（表名是否使用下划线命名）:',
            choices: [
                { name: '未设置 / 自动检测（保持原表名）', value: undefined },
                { name: '启用（true）- 驼峰转下划线，如 userRoles -> user_roles', value: true },
                { name: '禁用（false）- 下划线转驼峰，如 user_roles -> userRoles', value: false }
            ],
            default: undefined
        }
    ]);

    // 自动生成带时间戳的文件名
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    const outputFile = `./merged_export_${timestamp}.sql`;

    console.log(`\n   输出文件: ${outputFile}`);
    if (dbUnderscored !== undefined) {
        console.log(`   DB_UNDERSCORED: ${dbUnderscored ? '启用（驼峰->下划线）' : '禁用（下划线->驼峰）'}`);
    }

    // 生成配置对象
    const config = {
        source: sourceAnswers,
        target: targetAnswers,
        export: {
            excludeTables: excludeTables,
            outputFile: outputFile,
            dbUnderscored: dbUnderscored
        }
    };

    // 写入文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    console.log('\n✓ 配置文件已生成: config.json');
    console.log('\n配置摘要:');
    console.log(`  Source: ${sourceAnswers.user}@${sourceAnswers.host}:${sourceAnswers.port}/${sourceAnswers.database}`);
    console.log(`  Target: ${targetAnswers.user}@${targetAnswers.host}:${targetAnswers.port}/${targetAnswers.database}`);
    console.log(`  排除表数量: ${excludeTables.length} 个`);
    if (excludeTables.length <= 10) {
        console.log(`  排除表: ${excludeTables.join(', ')}`);
    } else {
        console.log(`  排除表: ${excludeTables.slice(0, 5).join(', ')} ... (共 ${excludeTables.length} 个)`);
    }
    console.log(`  输出文件: ${outputFile} (自动添加时间戳)`);
    console.log('\n运行以下命令开始导出:');
    console.log('  dbm\n');
}

// 处理命令行参数
async function main() {
    if (args.length === 0) {
        // 没有参数，使用默认配置文件
        const configPath = path.join(process.cwd(), 'config.json');

        if (!fs.existsSync(configPath)) {
            console.error('✗ 未找到 config.json 配置文件');
            console.log('\n运行以下命令生成配置模板:');
            console.log('  dbm --init');
            process.exit(1);
        }

        // 执行主程序
        require('../merge-export.js');

    } else if (args[0] === '--help' || args[0] === '-h') {
        showHelp();

    } else if (args[0] === '--version' || args[0] === '-v') {
        showVersion();

    } else if (args[0] === '--init') {
        await initConfig();

    } else {
        // 指定了配置文件路径
        const configPath = path.resolve(process.cwd(), args[0]);

        if (!fs.existsSync(configPath)) {
            console.error(`✗ 配置文件不存在: ${configPath}`);
            process.exit(1);
        }

        // 修改 process.argv 传递给主程序
        process.argv[2] = configPath;
        require('../merge-export.js');
    }
}

// 运行主函数
main().catch(error => {
    console.error('发生错误:', error.message);
    process.exit(1);
});
