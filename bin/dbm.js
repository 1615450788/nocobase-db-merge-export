#!/usr/bin/env node

/**
 * DBM - Database Merge Export Tool
 * 全局命令行工具入口
 */

const path = require('path');
const fs = require('fs');
const inquirer = require('inquirer');
const mysql = require('mysql2/promise');
const { mergeExports, loadConfig } = require('../merge-export.js');

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
DBM - Database Configuration Data Export Tool
用于 NocoBase 应用版本升级时的单库配置数据导出与覆盖补丁生成工具

用法:
  dbm [配置文件]                    使用指定配置文件导出
  dbm                              使用当前目录的 config.json
  dbm --help, -h                   显示此帮助信息
  dbm --version, -v                显示版本信息
  dbm --init                       交互式生成配置文件（兼容旧版本）

新的交互式模式:
  如果未提供配置文件，将自动进入交互式配置并立即执行导出

命令行参数模式:
  dbm --host 127.0.0.1 --port 3306 --user root --password pass --database dbname [其他选项]

命令行选项:
  --host, -h             数据库主机（默认: 127.0.0.1）
  --port, -P             数据库端口（默认: 3306）
  --user, -u             数据库用户名（默认: root）
  --password, -p         数据库密码
  --database, -d         数据库名（必需）
  --exclude-tables       排除的业务表（逗号分隔，可选 - 如未提供将自动从数据库动态读取并包含预设环境数据表）
  --output-file, -o      输出 SQL 文件路径（默认自动添加时间戳）
  --db-underscored       表名转换 true/false（默认: auto）

环境变量:
  DB_HOST                数据库主机
  DB_PORT                数据库端口
  DB_USER                数据库用户名
  DB_PASSWORD            数据库密码
  DB_NAME                数据库名
  DB_EXCLUDE_TABLES      排除的业务表（逗号分隔，可选 - 如未提供将自动从数据库动态读取并包含预设环境数据表）
  DB_OUTPUT_FILE         输出 SQL 文件路径
  DB_UNDERSCORED         表名转换 true/false

示例:
  dbm                              # 使用 ./config.json 或交互式配置
  dbm ./my-config.json             # 使用自定义配置文件
  dbm --host localhost --database nocobase --user root --password 123456
  DB_HOST=localhost DB_NAME=nocobase dbm  # 使用环境变量

配置文件格式:
  {
    "source": {
      "host": "127.0.0.1",
      "port": 3306,
      "user": "root",
      "password": "password",
      "database": "database_name"
    },
    "export": {
      "excludeTables": ["users", "roles"],
      "outputFile": "./config_export.sql",
      "dbUnderscored": true
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
async function initConfig(saveToFile = true) {
    const configPath = path.join(process.cwd(), 'config.json');

    if (saveToFile && fs.existsSync(configPath)) {
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

    // 数据库配置
    console.log('📦 数据库配置（仅导出该库的纯配置数据）:\n');
    const sourceAnswers = await inquirer.prompt([
        {
            type: 'input',
            name: 'host',
            message: '数据库主机:',
            default: process.env.DB_HOST || '127.0.0.1'
        },
        {
            type: 'number',
            name: 'port',
            message: '数据库端口:',
            default: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306
        },
        {
            type: 'input',
            name: 'user',
            message: '数据库用户名:',
            default: process.env.DB_USER || 'root'
        },
        {
            type: 'password',
            name: 'password',
            message: '数据库密码:',
            default: process.env.DB_PASSWORD || '',
            mask: '*'
        },
        {
            type: 'input',
            name: 'database',
            message: '数据库名:',
            default: process.env.DB_NAME || '',
            validate: (input) => input.trim() !== '' || '数据库名不能为空'
        }
    ]);

    // 导出配置
    console.log('\n⚙️  导出配置:\n');

    // 选择预设表组合
    const { presetChoice } = await inquirer.prompt([
        {
            type: 'list',
            name: 'presetChoice',
            message: '选择业务表组合（这些表的数据将不被导出）:',
            choices: [
                { name: '组合1: 环境数据（工作流、变量、认证表等业务表）', value: 'approval' },
                { name: '组合2: 业务数据（从 collections 表获取的所有业务表）', value: 'business' },
                { name: '组合3: 全部业务数据（组合1 + 组合2）', value: 'all' },
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
                message: '业务表名单（这些表的数据将被排除），用逗号分隔（留空将在执行时自动从数据库动态读取）:',
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
            default: process.env.DB_UNDERSCORED === 'true' ? true : process.env.DB_UNDERSCORED === 'false' ? false : undefined
        }
    ]);

    // 自动生成带时间戳的文件名
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    let outputFile = process.env.DB_OUTPUT_FILE || `./merged_export_${timestamp}.sql`;
    // 如果用户提供的文件名没有时间戳，自动添加时间戳（如果还没有）
    if (process.env.DB_OUTPUT_FILE && !/\d{8}_\d{6}/.test(outputFile)) {
        outputFile = outputFile.replace(/\.sql$/, `_${timestamp}.sql`);
    }

    console.log(`\n   输出文件: ${outputFile}`);
    if (dbUnderscored !== undefined) {
        console.log(`   DB_UNDERSCORED: ${dbUnderscored ? '启用（驼峰->下划线）' : '禁用（下划线->驼峰）'}`);
    }

    // 生成配置对象
    const config = {
        source: sourceAnswers,
        export: {
            excludeTables: excludeTables,
            outputFile: outputFile,
            dbUnderscored: dbUnderscored
        }
    };

    // 写入文件（如果要求保存）
    if (saveToFile) {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log('\n✓ 配置文件已生成: config.json');
        console.log('\n配置摘要:');
        console.log(`  数据库: ${sourceAnswers.user}@${sourceAnswers.host}:${sourceAnswers.port}/${sourceAnswers.database}`);
        console.log(`  排除表数量: ${excludeTables.length} 个`);
        if (excludeTables.length <= 10) {
            console.log(`  排除表: ${excludeTables.join(', ')}`);
        } else {
            console.log(`  排除表: ${excludeTables.slice(0, 5).join(', ')} ... (共 ${excludeTables.length} 个)`);
        }
        console.log(`  输出文件: ${outputFile} (自动添加时间戳)`);
        console.log('\n运行以下命令开始导出:');
        console.log('  dbm\n');
    } else {
        console.log('\n✓ 配置完成，开始导出...\n');
    }

    return config;
}

// 处理命令行参数
async function main() {
    // 处理帮助和版本信息
    if (args.length > 0) {
        if (args[0] === '--help' || args[0] === '-h') {
            showHelp();
            return;
        } else if (args[0] === '--version' || args[0] === '-v') {
            showVersion();
            return;
        } else if (args[0] === '--init') {
            // 生成配置文件并退出（兼容旧行为）
            await initConfig(true);
            return;
        }
    }

    // 解析命令行参数
    const cliConfig = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            // 检查下一个参数是否是值（不是以 -- 开头）
            if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                const value = args[i + 1];
                cliConfig[key] = value;
                i++; // 跳过值
            } else {
                // 布尔标志（如 --db-underscored 后面可能没有值，但需要值）
                cliConfig[key] = true; // 默认 true，实际可能需要值
            }
        }
    }

    // 检查是否通过命令行提供了数据库配置
    const hasCliDbConfig = cliConfig.host && cliConfig.port && cliConfig.user && cliConfig.database;
    // 注意：password 可能为空，但通常需要

    // 检查是否通过环境变量提供了数据库配置
    const hasEnvDbConfig = process.env.DB_HOST && process.env.DB_NAME;
    // DB_USER 可以有默认值 'root'，DB_PORT 可以有默认值 '3306'，DB_PASSWORD 可以为空

    let config;

    if (hasCliDbConfig) {
        // 使用命令行参数构建配置
        console.log('使用命令行参数配置...\n');
        config = buildConfigFromCli(cliConfig);
    } else if (hasEnvDbConfig) {
        // 使用环境变量构建配置
        console.log('使用环境变量配置...\n');
        const envConfig = {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || '3306',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME,
            'exclude-tables': process.env.DB_EXCLUDE_TABLES,
            'output-file': process.env.DB_OUTPUT_FILE,
            'db-underscored': process.env.DB_UNDERSCORED
        };
        config = buildConfigFromCli(envConfig);
    } else if (args.length === 0) {
        // 没有参数，检查默认配置文件
        const configPath = path.join(process.cwd(), 'config.json');

        if (fs.existsSync(configPath)) {
            // 使用现有配置文件
            console.log(`使用配置文件: ${configPath}\n`);
            config = await loadConfig(configPath);
        } else {
            // 没有配置文件，进入交互式配置并直接导出
            console.log('未找到配置文件，进入交互式配置模式...\n');
            config = await initConfig(false);
        }
    } else {
        // 有参数，第一个参数可能是配置文件路径
        const configPath = path.resolve(process.cwd(), args[0]);

        // 检查是否是文件路径（不是以 -- 开头的选项）
        if (!args[0].startsWith('--') && fs.existsSync(configPath)) {
            // 使用指定的配置文件
            console.log(`使用配置文件: ${configPath}\n`);
            config = await loadConfig(configPath);
        } else {
            // 否则视为命令行选项但缺少必要参数
            console.error('✗ 命令行参数缺少必要的数据库配置');
            console.log('\n请提供以下参数: --host, --port, --user, --password, --database');
            console.log('或使用交互式配置模式（不提供任何参数）');
            process.exit(1);
        }
    }

    // 执行导出
    await mergeExports(config);
}

// 从命令行参数构建配置对象
function buildConfigFromCli(cliConfig) {
    const source = {
        host: cliConfig.host || '127.0.0.1',
        port: parseInt(cliConfig.port, 10) || 3306,
        user: cliConfig.user || 'root',
        password: cliConfig.password || '',
        database: cliConfig.database || ''
    };

    // 处理 excludeTables
    let excludeTables = [];
    if (cliConfig['exclude-tables']) {
        excludeTables = cliConfig['exclude-tables'].split(',').map(s => s.trim()).filter(s => s);
    } else if (cliConfig.excludeTables) {
        excludeTables = cliConfig.excludeTables.split(',').map(s => s.trim()).filter(s => s);
    }
    // 如果没有提供，使用空数组（将在导出时处理）

    // 处理 dbUnderscored
    let dbUnderscored = undefined;
    if (cliConfig['db-underscored'] !== undefined) {
        const val = cliConfig['db-underscored'];
        if (val === 'true' || val === true) dbUnderscored = true;
        else if (val === 'false' || val === false) dbUnderscored = false;
        // 否则保持 undefined
    }

    // 处理输出文件
    let outputFile = cliConfig['output-file'] || cliConfig.outputFile || './merged_export.sql';
    // 自动添加时间戳（如果还没有）
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    if (!/\d{8}_\d{6}/.test(outputFile)) {
        outputFile = outputFile.replace(/\.sql$/, `_${timestamp}.sql`);
    }

    return {
        source,
        export: {
            excludeTables,
            outputFile,
            dbUnderscored
        }
    };
}

// 运行主函数
main().catch(error => {
    console.error('发生错误:', error.message);
    process.exit(1);
});
