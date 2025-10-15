# NocoBase 数据库导出合并工具 (DBM)

[English](README.en.md) | 简体中文

用于 NocoBase 应用版本升级时,从两个数据库导出并合并数据的专业工具。支持 MySQL / MariaDB。

## 核心功能

### 🚀 智能数据合并
- **结构来自 Source**：导出 Source 数据库的完整表结构
- **数据混合导入**：大部分数据来自 Source，指定表的数据来自 Target
- **自动列匹配**：智能处理表结构差异，只导出公共列
- **去重保护**：使用 `REPLACE INTO` 自动处理主键冲突

### 📦 预设表组合
- **组合1：审批数据**（8个固定表）- 工作流、审批相关
- **组合2：业务数据**（动态获取）- 从 `collections` 表自动读取
- **组合3：全部数据**（组合1+2）- 完整生产环境数据
- **自定义组合** - 手动指定任意表列表

### 🛡️ 数据安全特性
- ✅ **BIGINT 精度保护** - 避免大整数溢出导致的数据损坏
- ✅ **列差异容错** - Source 和 Target 表结构版本不一致时自动处理
- ✅ **虚拟表过滤** - 自动跳过 NocoBase 的虚拟表
- ✅ **重复表去重** - 自动检测并去除重复的表名
- ✅ **事务支持** - 使用 `--single-transaction` 保证数据一致性

### 🎯 用户体验
- ✅ **交互式向导** - 友好的问答式配置流程
- ✅ **自动时间戳** - 每次导出生成唯一文件名，不覆盖历史
- ✅ **详细日志** - 实时显示导出进度和表信息
- ✅ **列差异提示** - 自动提示 Source 独有列和 Target 独有列
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

📦 Source 数据库配置（导出结构和大部分数据）:

? Source 数据库主机: 127.0.0.1
? Source 数据库端口: 3306
? Source 数据库用户名: root
? Source 数据库密码: ****
? Source 数据库名: nocobase_dev

📦 Target 数据库配置（提供排除表的数据）:

? Target 数据库连接信息是否与 Source 相同? Yes
? Target 数据库名: nocobase_prod

⚙️  导出配置:

? 选择排除表组合（这些表的数据将从 Target 数据库获取）:
  ❯ 组合1: 审批数据（工作流、审批相关表）
    组合2: 业务数据（从 collections 表获取）
    组合3: 全部数据（审批数据 + 业务数据）
    自定义（手动输入）

   ✓ 已选择审批数据组合 (8 个表)
      - workflow_cc_tasks
      - user_workflow_tasks
      - approval_records
      - approval_executions
      - jobs
      - executions
      - approvals
      - workflow_stats

   输出文件: ./merged_export_20251015_143025.sql

✓ 配置文件已生成: config.json
```

### 2. 或手动编辑配置文件

如果您更喜欢手动编辑，可以直接创建 `config.json`：

```json
{
  "source": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "123456",
    "database": "nocobase_dev"
  },
  "target": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "123456",
    "database": "nocobase_prod"
  },
  "export": {
    "excludeTables": [
      "workflow_cc_tasks",
      "user_workflow_tasks",
      "approval_records",
      "approval_executions",
      "jobs",
      "executions",
      "approvals",
      "workflow_stats"
    ],
    "outputFile": "./merged_export.sql"
  }
}
```

#### 配置参数说明

- **source**: 源数据库配置（导出结构和大部分数据）
- **target**: 目标数据库配置（提供排除表的数据）
- **export.excludeTables**: 需要从 target 数据库获取数据的表列表
- **export.outputFile**: 输出的 SQL 文件路径

#### 预设表组合说明

**组合1：审批数据**（默认）
- 包含工作流、审批相关的 8 个表
- 适用于需要保留生产环境的审批流程数据
- 表列表：
  - `workflow_cc_tasks` - 工作流抄送任务
  - `user_workflow_tasks` - 用户工作流任务
  - `approval_records` - 审批记录
  - `approval_executions` - 审批执行
  - `jobs` - 作业任务
  - `executions` - 执行记录
  - `approvals` - 审批
  - `workflow_stats` - 工作流统计

**组合2：业务数据**
- 自动从 Target 数据库的 `collections` 表读取业务表列表
- 自动过滤虚拟表（仅导出真实存在的表）
- 适用于需要保留生产环境的所有业务数据
- 表数量动态，取决于您的 NocoBase 应用配置

**组合3：全部数据**（推荐用于完整迁移）
- 包含组合1 + 组合2 的所有表
- 自动去重，避免重复表名
- 适用于需要完整保留生产环境数据的场景
- 同时保留审批流程和业务数据

**自定义**
- 手动输入表名列表（逗号分隔）
- 完全自定义控制

### 3. 执行导出

配置完成后，运行导出命令：

```bash
dbm
```

**注意**：每次导出都会自动生成带时间戳的唯一文件名，格式为 `merged_export_YYYYMMDD_HHMMSS.sql`，无需担心覆盖之前的导出文件。

## 使用方法

### 命令行选项

```bash
# 使用当前目录的 config.json
dbm

# 使用指定配置文件
dbm ./my-config.json

# 生成配置文件模板
dbm --init

# 显示帮助信息
dbm --help
dbm -h

# 显示版本信息
dbm --version
dbm -v
```

### 本地开发使用

如果未全局安装，可以使用以下方式：

```bash
# 直接运行脚本
node merge-export.js

# 使用自定义配置
node merge-export.js ./my-config.json

# 使用 npm scripts
npm run export
```

## 技术原理

### 导出流程

```
┌─────────────────────────────────────────────────────────┐
│ 1. Source 数据库                                         │
│    ├─ 导出所有表结构 (--no-data)                        │
│    └─ 导出非排除表的数据 (--ignore-table)               │
├─────────────────────────────────────────────────────────┤
│ 2. Target 数据库                                         │
│    ├─ 连接并验证表存在性                                 │
│    ├─ 获取 Source 表的列名（作为基准）                  │
│    ├─ 获取 Target 表的列名                               │
│    ├─ 计算列交集（只导出公共列）                         │
│    └─ 生成 REPLACE INTO 语句                             │
├─────────────────────────────────────────────────────────┤
│ 3. 数据合并                                              │
│    ├─ DELETE FROM 清空排除表                             │
│    ├─ REPLACE INTO 插入 Target 数据                      │
│    └─ 自动处理主键冲突                                   │
└─────────────────────────────────────────────────────────┘
```

### 关键技术点

#### 1. BIGINT 精度保护
```javascript
// mysql2 配置
{
  supportBigNumbers: true,
  bigNumberStrings: true  // BIGINT 作为字符串返回
}
```

#### 2. 列匹配算法
```javascript
sourceColumns = ['id', 'name', 'status', 'old_field']
targetColumns = ['id', 'name', 'status', 'new_field']
commonColumns = ['id', 'name', 'status']  // 取交集

// 只查询公共列
SELECT `id`, `name`, `status` FROM target_table
```

#### 3. 去重策略
```sql
-- 清空表数据
DELETE FROM `excluded_table`;

-- 使用 REPLACE INTO 自动处理重复
REPLACE INTO `excluded_table` (`id`, `name`, `status`) VALUES
('1939992168045813800', 'test', 'active');
```

## 导入生成的 SQL 文件

```bash
mysql -u username -p database_name < merged_export.sql
```

或使用 MariaDB：

```bash
mariadb -u username -p database_name < merged_export.sql
```

## 常见问题

### Q1: 为什么需要两个数据库？
**A**: NocoBase 版本升级时，需要新版本的表结构（Source），但保留生产环境的业务数据（Target）。

### Q2: 如何处理表结构不一致？
**A**: 工具会自动计算列交集，只导出两个数据库都存在的列，Source 独有的列会使用默认值。

### Q3: 导入时报主键冲突怎么办？
**A**: 工具使用 `REPLACE INTO` 和 `DELETE FROM`，自动处理主键冲突，无需手动干预。

### Q4: BIGINT 主键重复问题？
**A**: 已配置 `bigNumberStrings: true`，确保大整数不会因精度丢失而重复。

### Q5: 如何选择预设表组合？
- **组合1（审批数据）**：只需要保留审批流程记录
- **组合2（业务数据）**：只需要保留业务数据表
- **组合3（全部数据）**：完整迁移生产环境数据（推荐）

## 使用场景

### 场景1：NocoBase 版本升级
```bash
# Source = 新版本空数据库（表结构最新）
# Target = 生产环境旧版本数据库
dbm --init  # 选择组合3
```

### 场景2：测试环境同步生产数据
```bash
# Source = 测试环境（最新代码）
# Target = 生产环境（真实数据）
dbm --init  # 选择组合2（业务数据）
```

### 场景3：数据库结构变更后数据迁移
```bash
# Source = 新表结构数据库
# Target = 旧表结构数据库
dbm  # 自动处理列差异
```

## 注意事项

### 前置要求
1. ✅ 确保已安装 `mysqldump` 或 `mariadb-dump` 命令行工具
2. ✅ Node.js 版本 >= 14.0.0
3. ✅ 有足够的磁盘空间存储导出文件

### 安全建议
1. ⚠️ 导入前先备份目标数据库
2. ⚠️ 在测试环境验证导入成功后再应用到生产
3. ⚠️ 大型数据库（> 1GB）导出可能需要较长时间
4. ⚠️ 确保网络稳定，避免导出中断

## 对比传统方案

| 特性 | DBM 工具 | 纯 mysqldump | 手动导入导出 |
|------|---------|-------------|-------------|
| 混合数据源 | ✅ 自动 | ❌ 不支持 | ⚠️ 手动操作 |
| 列差异处理 | ✅ 自动匹配 | ❌ 报错 | ⚠️ 手动修改 SQL |
| BIGINT 精度 | ✅ 保护 | ✅ 正常 | ⚠️ 易出错 |
| 主键冲突 | ✅ 自动处理 | ❌ 报错 | ⚠️ 手动去重 |
| 虚拟表过滤 | ✅ 自动 | ❌ 会导出 | ⚠️ 手动排除 |
| 时间戳管理 | ✅ 自动 | ❌ 需手动 | ⚠️ 易覆盖 |
| 交互式配置 | ✅ 向导式 | ❌ 命令行 | ❌ 无 |

## 输出示例

生成的 SQL 文件结构：

```sql
-- ============================================================
-- NocoBase Database Merge Export Tool
-- ============================================================
-- Export Time: 2025-10-15 14:30:25
-- SOURCE DATABASE: nocobase_dev@127.0.0.1:3306
-- TARGET DATABASE: nocobase_prod@127.0.0.1:3306
-- EXCLUDED TABLES: approval_records, users, ...
-- ============================================================

-- Source 的表结构
CREATE TABLE `users` (...);
CREATE TABLE `approval_records` (...);

-- Source 的数据（非排除表）
INSERT INTO `departments` VALUES (...);

-- ============================================================
-- Data from target database for excluded tables
-- ============================================================

-- approval_records
-- Common columns: 8 (Source: 10, Target: 9)
-- Source-only columns: old_field, deprecated_col
-- Target-only columns: new_field

DELETE FROM `approval_records`;
REPLACE INTO `approval_records` (`id`,`name`,...) VALUES
('1939992168045813800','审批记录',...);
```

## 依赖要求

- Node.js >= 14.0.0
- MySQL/MariaDB 客户端工具 (mysqldump / mariadb-dump)
- npm 包：mysql2, inquirer

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

### 开发
```bash
git clone https://github.com/1615450788/nocobase-db-merge-export.git
cd nocobase-db-merge-export
npm install
npm link  # 本地测试
```

### 测试
```bash
dbm --init
dbm
```
