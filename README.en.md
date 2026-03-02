# NocoBase Configuration Data Export Tool (DBM)

English | [简体中文](README.md)

A professional tool for exporting pure configuration data from a single database during NocoBase application version upgrades. It generates a SQL patch file that can be directly executed on the target database to overwrite configurations losslessly. Supports MySQL / MariaDB.

## Core Features

### 🚀 Pure Configuration Data Extraction
- **No Structure Export**: Target database structure remains unchanged, only data is updated
- **Exclude Business Data**: Intelligently ignores business tables and their associated data, focusing on environment configurations
- **Overwrite Update**: Uses `TRUNCATE TABLE` to clear before inserting, completely solving leftover dirty data issues

### 📦 Preset Business Table Combinations (Data from these tables will be excluded)
- **Combination 1: Approval Data** (8 fixed tables) - Workflow and approval related, **auto-includes many-to-many junction tables**
- **Combination 2: Business Data** (dynamically fetched) - Auto-read from `collections` table, **auto-includes many-to-many junction tables**
- **Combination 3: All Data** (Combination 1+2) - Complete business environment table list, **auto-includes all many-to-many junction tables**
- **Custom Combination** - Manually specify any business table list, **auto-includes many-to-many junction tables**

### 🛡️ Data Safety Features
- ✅ **Large Batch Export** - Processes large amounts of tables in batches to prevent parameter overflow
- ✅ **Virtual Table Filtering** - Auto-skips NocoBase virtual tables
- ✅ **Transaction Support** - Uses `--single-transaction` to ensure data consistency
- ✅ **Many-to-Many Junction Table Auto-Detection** - Automatically queries and includes m2m field junction tables for excluded tables
- ✅ **DB_UNDERSCORED Support** - Auto-converts camelCase/snake_case table names to adapt different NocoBase configurations

### 🎯 User Experience
- ✅ **Interactive Wizard** - Friendly Q&A-style configuration process
- ✅ **Auto Timestamp** - Generates unique filename for each export, no history overwriting
- ✅ **Detailed Logs** - Real-time display of export progress and table information
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

📦 Database Configuration (only export pure configuration data from this db):

? Database host: 127.0.0.1
? Database port: 3306
? Database username: root
? Database password: ****
? Database name: nocobase_dev

⚙️  Export Configuration:

? Select business table combination (data from these tables will be excluded):
  ❯ Combination 1: Approval Data (workflow, approval related tables)
    Combination 2: Business Data (fetched from collections table)
    Combination 3: All Business Data (approval data + business data)
    Custom (manual input)

   ✓ Selected approval data combination (8 tables)
      - workflow_cc_tasks
      - user_workflow_tasks
      - approval_records
...

   Output file: ./config_export_20251015_143025.sql

✓ Config file generated: config.json
```

### 2. Execute Export

After configuration, run:

```bash
dbm
```

If you installed locally:
```bash
npm run export
```

### 3. Import to Target Database

The exported SQL file can be directly executed in the target database:

```bash
mysql -u username -p target_database_name < config_export_20251015_143025.sql
```

## Advanced Usage

### Config File Format (`config.json`)

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

### Command Line Arguments

```bash
dbm [config_file]                  Use specified config file
dbm                                Use config.json in current directory
dbm --help, -h                     Show help info
dbm --version, -v                  Show version info
dbm --init                         Interactive config generation
```

## Notes

1. The system must have `mysqldump` installed and added to environment variables.
2. Before executing the configuration data file, please be sure to back up the target database, because the tool uses **TRUNCATE** to overwrite data.
3. If the NocoBase project has the `DB_UNDERSCORED=true` environment variable enabled, please select the corresponding option in the wizard. The tool will automatically convert table names.

## License

MIT
