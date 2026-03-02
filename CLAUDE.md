# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**nocobase-db-merge-export** (dbm) is a specialized CLI tool for NocoBase application version upgrades. It exports pure configuration data from a single database (Source) while excluding business data, generating a SQL patch file that truncates and overwrites tables in a target database.

**Key Concept**: 
- **Goal**: Export configuration data only (no structure)
- **Data**: All configuration tables from Source get their data exported via `mysqldump --no-create-info`
- **Exclusion**: Business tables (excludeTables) and their M2M junction tables are completely ignored
- **Overwrite**: Generated SQL includes `TRUNCATE TABLE` statements before inserts to safely overwrite old configuration data without leaving dirty data behind

## Core Architecture

### Entry Points
- **Global CLI**: `bin/dbm.js` - Handles command-line arguments, interactive configuration wizard (`--init`), and delegates to merge-export.js
- **Main Logic**: `merge-export.js` - Performs the database queries and SQL dump generation

### Export Pipeline (3 Steps)

```
Step 0: Auto-detect M2M junction tables
  └─ Query fields table where interface='m2m'
  └─ Parse options JSON → extract 'through' property
  └─ Add junction tables to excludeTables list (business tables)

Step 1: Calculate configuration tables
  └─ Query SHOW TABLES
  └─ Filter out all excludeTables

Step 2: Export configuration data
  └─ Write SET FOREIGN_KEY_CHECKS=0 and TRUNCATE TABLE statements
  └─ mysqldump --no-create-info (only config tables) in chunks
  └─ Append to output file
```

### Key Technical Features

#### 1. DB_UNDERSCORED Table Name Conversion
```javascript
// config.export.dbUnderscored controls table name format
dbUnderscored: true   // userRoles → user_roles (camelCase to snake_case)
dbUnderscored: false  // user_roles → userRoles (snake_case to camelCase)
dbUnderscored: undefined  // No conversion (keep original names)
```

#### 2. M2M Junction Table Auto-Detection
Automatically finds many-to-many relationship junction tables by:
- Querying `fields` table where `interface = 'm2m'`
- Parsing `options` JSON column to extract `through` property
- Adding found tables to excludeTables list with deduplication

#### 3. Chunked Data Export
To avoid "Argument list too long" errors when passing many tables to `mysqldump`, tables are sliced into chunks (e.g. 50 tables per chunk) and exported sequentially.

## Configuration

### Config File Structure (`config.json`)
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
    "excludeTables": ["users", "roles", "approvals"],
    "outputFile": "./config_export.sql",
    "dbUnderscored": true
  }
}
```

## Common Development Tasks

### Running the Tool

```bash
# Development mode (local)
node merge-export.js                  # Use ./config.json
node merge-export.js ./custom.json    # Use custom config
npm run export                        # npm script alias

# Global mode
dbm                                   # Use ./config.json
dbm ./custom.json                     # Use custom config
dbm --init                           # Interactive wizard
```

### Development Workflow for New Features

1. **Modify `merge-export.js`** for core export logic changes
2. **Modify `bin/dbm.js`** for CLI interface changes
3. **Test locally**: `npm link` then `dbm --init` to test as global command
4. **Update README.md** (Chinese primary, English secondary)

## Dependencies

- **mysql2**: Database connections with promise support
- **inquirer**: Interactive CLI prompts (v8.2.6)
- **mysqldump**: External command (must be installed separately)
