# NocoBase 配置数据导出覆盖工具 (DBM)

[English](README.en.md) | 简体中文

用于 NocoBase 应用版本升级时，提取并导出单数据库纯配置数据的专业工具，生成可直接在目标库执行以无损覆盖配置的 SQL 补丁文件。支持 MySQL / MariaDB。

## 核心功能

### 🚀 纯配置数据提取
- **不导出表结构**：默认目标库结构不变，仅更新数据
- **排除业务数据**：智能忽略业务表及其关联数据，专注于提取环境配置
- **覆盖式更新**：通过 `TRUNCATE TABLE` 先清空再插入，彻底解决脏数据残留问题

### 📦 预设业务表组合（这些表的数据将被排除）
- **组合1：审批数据**（8个固定表）- 工作流、审批相关，**自动包含多对多关联表**
- **组合2：业务数据**（动态获取）- 从 `collections` 表自动读取，**自动包含多对多关联表**
- **组合3：全部数据**（组合1+2）- 完整的业务环境表列表，**自动包含所有多对多关联表**
- **自定义组合** - 手动指定任意业务表列表，**自动包含多对多关联表**

### 🛡️ 数据安全特性
- ✅ **大批量导出** - 分批处理大量表，避免参数超长溢出
- ✅ **虚拟表过滤** - 自动跳过 NocoBase 的虚拟表
- ✅ **事务支持** - 使用 `--single-transaction` 保证数据一致性
- ✅ **多对多关联表自动检测** - 自动查询并包含排除表的 m2m 字段关联表（junction tables）
- ✅ **DB_UNDERSCORED 支持** - 自动转换驼峰/下划线表名，适配不同的 NocoBase 配置

### 🎯 用户体验
- ✅ **交互式向导** - 友好的问答式配置流程
- ✅ **自动时间戳** - 每次导出生成唯一文件名，不覆盖历史
- ✅ **详细日志** - 实时显示导出进度和表信息
- ✅ **一键安装** - 支持全局安装，任意目录使用

## 安装

### 全局安装（推荐）

```bash
npm install -g nocobase-db-merge-export
```

安装后可在任何目录使用 `dbm` 命令。

### 本地安装

```bash
npm install
```

## 快速开始

### 1. 交互式生成配置文件

```bash
dbm --init
```

该命令将启动交互式配置向导，引导您完成配置：

```
🔧 配置数据库导出工具

📦 数据库配置（仅导出该库的纯配置数据）:

? 数据库主机: 127.0.0.1
? 数据库端口: 3306
? 数据库用户名: root
? 数据库密码: ****
? 数据库名: nocobase_dev

⚙️  导出配置:

? 选择业务表组合（这些表的数据将不被导出）:
  ❯ 组合1: 审批数据（工作流、审批相关表）
    组合2: 业务数据（从 collections 表获取）
    组合3: 全部业务数据（审批数据 + 业务数据）
    自定义（手动输入）

   ✓ 已选择审批数据组合 (8 个表)
      - workflow_cc_tasks
      - user_workflow_tasks
      - approval_records
...

   输出文件: ./config_export_20251015_143025.sql

✓ 配置文件已生成: config.json
```

### 2. 执行导出

配置完成后，运行：

```bash
dbm
```

如果您使用本地安装：
```bash
npm run export
```

### 3. 导入目标数据库覆盖

导出的 SQL 文件可以直接在目标数据库中执行：

```bash
mysql -u username -p target_database_name < config_export_20251015_143025.sql
```

## 高级用法

### 配置文件说明 (`config.json`)

```json
{
  "source": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "password",
    "database": "nocobase_dev"
  },
  "export": {
    "excludeTables": [
      "workflow_cc_tasks",
      "user_workflow_tasks",
      "approval_records"
    ],
    "outputFile": "./config_export.sql",
    "dbUnderscored": true
  }
}
```

### 命令行参数

```bash
dbm [配置文件]                    使用指定配置文件导出
dbm                              使用当前目录的 config.json
dbm --help, -h                   显示帮助信息
dbm --version, -v                显示版本信息
dbm --init                       交互式生成配置文件
```

## 注意事项

1. 系统必须已安装 `mysqldump` 并加入环境变量。
2. 配置数据文件执行前，请务必备份目标数据库，因为工具使用的是 **TRUNCATE** 清空写入模式。
3. 如果 NocoBase 项目开启了 `DB_UNDERSCORED=true` 环境变量，请在向导中选择相应的选项，工具会自动进行表名转换。

## License

MIT
