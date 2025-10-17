# 变更日志 / Changelog

本项目的所有重要变更都将记录在此文件中。

## [1.1.0] - 2025-10-17

### 新增功能 / Added
- ✨ **多对多关联表自动检测** - 自动查询并包含排除表的 m2m 字段关联表（junction tables）
  - 通过 `collections.name` 关联 `fields.collection_name`
  - 筛选 `fields.interface = 'm2m'` 的字段
  - 从 `fields.options` JSON 字段的 `through` 属性获取关联表名
  - 自动将关联表添加到 `excludeTables` 列表并去重

### 改进 / Improved
- 📦 预设表组合现在都会自动包含多对多关联表
  - 组合1（审批数据）: 自动包含审批相关的 m2m 关联表
  - 组合2（业务数据）: 自动包含业务数据的 m2m 关联表
  - 组合3（全部数据）: 自动包含所有 m2m 关联表
  - 自定义组合: 自动包含指定表的 m2m 关联表

- 🔍 导出流程优化
  - 新增步骤 0: 在导出前先查询多对多关联表
  - 更详细的日志输出，显示找到的关联表信息
  - 自动去重，避免重复添加已存在的表

### 技术细节 / Technical Details
- 新增 `getM2MJunctionTables()` 函数用于查询多对多关联表
- 在 `merge-export.js` 中集成关联表自动检测
- 在 `bin/dbm.js` 的交互式配置中集成关联表检测
- 更新 README.md 添加多对多关联表功能说明

### 示例 / Example
```bash
# 导出时自动检测多对多关联表
🔍 查询多对多关联表...
   ✓ 找到 3 个多对多字段
   ✓ users.roles -> user_roles
   ✓ users.departments -> user_departments
   ✓ posts.tags -> post_tags
   ✓ 共找到 3 个唯一的多对多关联表:
      - user_roles
      - user_departments
      - post_tags

   ✓ 已将 3 个多对多关联表添加到排除列表
   ✓ 排除表总数: 8 -> 11
```

---

## [1.0.4] - 2025-10-15

### 修复 / Fixed
- 🐛 修复导出时字符乱码问题
- 确保所有导出使用 utf8mb4 字符集

---

## [1.0.3] - 2025-10-14

### 改进 / Improved
- 优化导出性能

---

## [1.0.1] - 2025-10-13

### 修复 / Fixed
- 🐛 修复从 source 获取 collections 的问题，应该从 target 获取

---

## [1.0.0] - 2025-10-12

### 初始版本 / Initial Release
- 🎉 首次发布
- ✨ 支持从两个数据库导出并合并数据
- ✨ 交互式配置向导
- ✨ 预设表组合（审批数据、业务数据、全部数据）
- ✨ 自动列匹配和差异处理
- ✨ BIGINT 精度保护
- ✨ 虚拟表过滤
- ✨ 自动时间戳文件名

---

格式说明：
- 版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)
- 每个版本按以下类别组织变更：
  - `新增功能 / Added` - 新增的功能
  - `改进 / Improved` - 对现有功能的改进
  - `修复 / Fixed` - 问题修复
  - `废弃 / Deprecated` - 即将移除的功能
  - `移除 / Removed` - 已移除的功能
  - `安全 / Security` - 安全相关的修复
