# NocoBase Database Merge Export Tool (DBM)

English | [简体中文](README.md)

A professional tool for exporting and merging data from two databases during NocoBase application version upgrades. Supports MySQL / MariaDB.

## Core Features

### 🚀 Intelligent Data Merging
- **Structure from Source**: Export complete table structure from Source database
- **Mixed Data Import**: Most data from Source, specified table data from Target
- **Auto Column Matching**: Intelligently handles table structure differences, exports only common columns
- **Deduplication Protection**: Automatically handles primary key conflicts using `REPLACE INTO`

### 📦 Preset Table Combinations
- **Combination 1: Approval Data** (8 fixed tables) - Workflow and approval related, **auto-includes many-to-many junction tables**
- **Combination 2: Business Data** (dynamically fetched) - Auto-read from `collections` table, **auto-includes many-to-many junction tables**
- **Combination 3: All Data** (Combination 1+2) - Complete production environment data, **auto-includes all many-to-many junction tables**
- **Custom Combination** - Manually specify any table list, **auto-includes many-to-many junction tables**

### 🛡️ Data Safety Features
- ✅ **BIGINT Precision Protection** - Prevents data corruption from large integer overflow
- ✅ **Column Difference Tolerance** - Auto-handles Source and Target table structure version inconsistencies
- ✅ **Virtual Table Filtering** - Auto-skips NocoBase virtual tables
- ✅ **Duplicate Table Deduplication** - Auto-detects and removes duplicate table names
- ✅ **Transaction Support** - Uses `--single-transaction` to ensure data consistency
- ✅ **Many-to-Many Junction Table Auto-Detection** - Automatically queries and includes m2m field junction tables for excluded tables
- ✅ **DB_UNDERSCORED Support** - Auto-converts camelCase/snake_case table names to adapt different NocoBase configurations

### 🎯 User Experience
- ✅ **Interactive Wizard** - Friendly Q&A-style configuration process
- ✅ **Auto Timestamp** - Generates unique filename for each export, no history overwriting
- ✅ **Detailed Logs** - Real-time display of export progress and table information
- ✅ **Column Difference Prompts** - Auto-prompts for Source-only and Target-only columns
- ✅ **One-Click Install** - Supports global installation, use in any directory

## Installation

### Global Installation (Recommended)

```bash
npm install -g nocobase-db-merge-export
```

After installation, you can use the `dbm` command in any directory.

### Local Installation

```bash
npm install
```

## Quick Start

### 1. Interactive Config File Generation

```bash
dbm --init
```

This command will launch an interactive configuration wizard to guide you through setup:

```
🔧 Configure Database Export Tool

📦 Source Database Configuration (export structure and most data):

? Source database host: 127.0.0.1
? Source database port: 3306
? Source database username: root
? Source database password: ****
? Source database name: nocobase_dev

📦 Target Database Configuration (provide excluded table data):

? Is Target database connection same as Source? Yes
? Target database name: nocobase_prod

⚙️  Export Configuration:

? Select excluded table combination (data for these tables will come from Target database):
  ❯ Combination 1: Approval Data (workflow, approval related tables)
    Combination 2: Business Data (fetched from collections table)
    Combination 3: All Data (approval data + business data)
    Custom (manual input)

   ✓ Selected approval data combination (8 tables)
      - workflow_cc_tasks
      - user_workflow_tasks
      - approval_records
      - approval_executions
      - jobs
      - executions
      - approvals
      - workflow_stats

   Output file: ./merged_export_20251015_143025.sql

✓ Config file generated: config.json
```

### 2. Or Manually Edit Config File

If you prefer manual editing, create `config.json` directly:

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
    "outputFile": "./merged_export.sql",
    "dbUnderscored": true
  }
}
```

#### Configuration Parameters

- **source**: Source database configuration (export structure and most data)
- **target**: Target database configuration (provide excluded table data)
- **export.excludeTables**: List of tables to fetch data from target database
- **export.outputFile**: Output SQL file path
- **export.dbUnderscored**: (Optional) NocoBase DB_UNDERSCORED configuration
  - `true`: Enable underscore naming, auto-convert camelCase to snake_case (e.g., `userRoles` -> `user_roles`)
  - `false`: Disable underscore naming, auto-convert snake_case to camelCase (e.g., `user_roles` -> `userRoles`)
  - `undefined` or not set: Keep original table names, no conversion

#### Preset Table Combinations

**Combination 1: Approval Data** (Default)
- Contains 8 workflow and approval related tables
- Suitable for preserving production environment approval process data
- Table list:
  - `workflow_cc_tasks` - Workflow CC tasks
  - `user_workflow_tasks` - User workflow tasks
  - `approval_records` - Approval records
  - `approval_executions` - Approval executions
  - `jobs` - Job tasks
  - `executions` - Execution records
  - `approvals` - Approvals
  - `workflow_stats` - Workflow statistics

**Combination 2: Business Data**
- Auto-reads business table list from Target database's `collections` table
- Auto-filters virtual tables (exports only real tables)
- Suitable for preserving all production environment business data
- Dynamic table count, depends on your NocoBase application configuration

**Combination 3: All Data** (Recommended for complete migration)
- Contains all tables from Combination 1 + Combination 2
- Auto-deduplicates to avoid duplicate table names
- Suitable for scenarios requiring complete production environment data preservation
- Preserves both approval processes and business data

**Custom**
- Manually input table name list (comma-separated)
- Full custom control

### 3. Execute Export

After configuration, run the export command:

```bash
dbm
```

**Note**: Each export automatically generates a unique timestamped filename in format `merged_export_YYYYMMDD_HHMMSS.sql`, no need to worry about overwriting previous exports.

## Usage

### Command Line Options

```bash
# Use config.json in current directory
dbm

# Use specified config file
dbm ./my-config.json

# Generate config file template
dbm --init

# Show help information
dbm --help
dbm -h

# Show version information
dbm --version
dbm -v
```

### Local Development Usage

If not globally installed, use these methods:

```bash
# Run script directly
node merge-export.js

# Use custom config
node merge-export.js ./my-config.json

# Use npm scripts
npm run export
```

## Technical Principles

### Export Process

```
┌─────────────────────────────────────────────────────────┐
│ 0. Many-to-Many Junction Table Auto-Detection (NEW)     │
│    ├─ Connect to Source database                        │
│    ├─ Query fields table (interface = 'm2m')            │
│    ├─ Parse options JSON to get 'through' attribute     │
│    ├─ Add junction tables to excludeTables list         │
│    └─ Auto-deduplication                                │
├─────────────────────────────────────────────────────────┤
│ 1. Source Database                                       │
│    ├─ Export all table structures (--no-data)           │
│    └─ Export non-excluded table data (--ignore-table)   │
├─────────────────────────────────────────────────────────┤
│ 2. Target Database                                       │
│    ├─ Connect and verify table existence                │
│    ├─ Get Source table column names (as baseline)       │
│    ├─ Get Target table column names                     │
│    ├─ Calculate column intersection (export common only)│
│    └─ Generate REPLACE INTO statements                  │
├─────────────────────────────────────────────────────────┤
│ 3. Data Merging                                          │
│    ├─ DELETE FROM to clear excluded tables              │
│    ├─ REPLACE INTO to insert Target data                │
│    └─ Auto-handle primary key conflicts                 │
└─────────────────────────────────────────────────────────┘
```

### Key Technical Points

#### 1. Many-to-Many Junction Table Auto-Detection (NEW)
```javascript
// Query fields table for many-to-many fields
SELECT f.collection_name, f.name, f.options
FROM fields f
WHERE f.collection_name IN ('users', 'roles', ...)  -- Excluded table list
AND f.interface = 'm2m'
AND f.options IS NOT NULL

// Parse options JSON to get junction table name
const options = JSON.parse(field.options);
const junctionTable = options.through;  // e.g., 'user_roles'

// Automatically add to exclusion list
excludeTables.push(junctionTable);
```

#### 2. DB_UNDERSCORED Table Name Conversion (NEW)
```javascript
// CamelCase to snake_case
function camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

// snake_case to camelCase
function snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
}

// Examples
userRoles -> user_roles   (dbUnderscored: true)
user_roles -> userRoles   (dbUnderscored: false)
```

#### 3. BIGINT Precision Protection
```javascript
// mysql2 configuration
{
  supportBigNumbers: true,
  bigNumberStrings: true  // Return BIGINT as strings
}
```

#### 4. Column Matching Algorithm
```javascript
sourceColumns = ['id', 'name', 'status', 'old_field']
targetColumns = ['id', 'name', 'status', 'new_field']
commonColumns = ['id', 'name', 'status']  // Take intersection

// Query only common columns
SELECT `id`, `name`, `status` FROM target_table
```

#### 5. Deduplication Strategy
```sql
-- Clear table data
DELETE FROM `excluded_table`;

-- Use REPLACE INTO to auto-handle duplicates
REPLACE INTO `excluded_table` (`id`, `name`, `status`) VALUES
('1939992168045813800', 'test', 'active');
```

## Importing Generated SQL File

```bash
mysql -u username -p database_name < merged_export.sql
```

Or using MariaDB:

```bash
mariadb -u username -p database_name < merged_export.sql
```

## FAQ

### Q1: Why do I need two databases?
**A**: During NocoBase version upgrades, you need the new version's table structure (Source) while preserving production environment business data (Target).

### Q2: How to handle inconsistent table structures?
**A**: The tool automatically calculates column intersection, exports only columns that exist in both databases. Source-only columns will use default values.

### Q3: What if primary key conflicts occur during import?
**A**: The tool uses `REPLACE INTO` and `DELETE FROM` to automatically handle primary key conflicts, no manual intervention needed.

### Q4: BIGINT primary key duplication issue?
**A**: Configured with `bigNumberStrings: true` to ensure large integers don't duplicate due to precision loss.

### Q5: How to choose preset table combination?
- **Combination 1 (Approval Data)**: Only need to preserve approval process records
- **Combination 2 (Business Data)**: Only need to preserve business data tables
- **Combination 3 (All Data)**: Complete production environment data migration (recommended)

## Use Cases

### Case 1: NocoBase Version Upgrade
```bash
# Source = New version empty database (latest table structure)
# Target = Production environment old version database
dbm --init  # Choose Combination 3
```

### Case 2: Test Environment Sync Production Data
```bash
# Source = Test environment (latest code)
# Target = Production environment (real data)
dbm --init  # Choose Combination 2 (business data)
```

### Case 3: Data Migration After Database Structure Changes
```bash
# Source = New table structure database
# Target = Old table structure database
dbm  # Auto-handles column differences
```

## Important Notes

### Prerequisites
1. ✅ Ensure `mysqldump` or `mariadb-dump` command-line tool is installed
2. ✅ Node.js version >= 14.0.0
3. ✅ Sufficient disk space to store export files

### Safety Recommendations
1. ⚠️ Backup target database before importing
2. ⚠️ Verify import success in test environment before applying to production
3. ⚠️ Large databases (> 1GB) may take considerable time to export
4. ⚠️ Ensure network stability to avoid export interruption

## Comparison with Traditional Methods

| Feature | DBM Tool | Pure mysqldump | Manual Import/Export |
|---------|----------|---------------|---------------------|
| Mixed Data Sources | ✅ Automatic | ❌ Not Supported | ⚠️ Manual Operation |
| Column Difference Handling | ✅ Auto-Match | ❌ Errors | ⚠️ Manual SQL Modification |
| BIGINT Precision | ✅ Protected | ✅ Normal | ⚠️ Error-Prone |
| Primary Key Conflicts | ✅ Auto-Handle | ❌ Errors | ⚠️ Manual Deduplication |
| Virtual Table Filtering | ✅ Automatic | ❌ Exports | ⚠️ Manual Exclusion |
| Timestamp Management | ✅ Automatic | ❌ Manual | ⚠️ Easy Overwrite |
| Interactive Config | ✅ Wizard-Style | ❌ Command Line | ❌ None |

## Output Example

Generated SQL file structure:

```sql
-- ============================================================
-- NocoBase Database Merge Export Tool
-- ============================================================
-- Export Time: 2025-10-15 14:30:25
-- SOURCE DATABASE: nocobase_dev@127.0.0.1:3306
-- TARGET DATABASE: nocobase_prod@127.0.0.1:3306
-- EXCLUDED TABLES: approval_records, users, ...
-- ============================================================

-- Source table structures
CREATE TABLE `users` (...);
CREATE TABLE `approval_records` (...);

-- Source data (non-excluded tables)
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
('1939992168045813800','Approval Record',...);
```

## Dependencies

- Node.js >= 14.0.0
- MySQL/MariaDB client tools (mysqldump / mariadb-dump)
- npm packages: mysql2, inquirer

## License

MIT

## Contributing

Issues and Pull Requests are welcome!

### Development
```bash
git clone https://github.com/1615450788/nocobase-db-merge-export.git
cd nocobase-db-merge-export
npm install
npm link  # Local testing
```

### Testing
```bash
dbm --init
dbm
```
