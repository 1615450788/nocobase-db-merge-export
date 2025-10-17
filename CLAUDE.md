# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**nocobase-db-merge-export** (dbm) is a specialized CLI tool for NocoBase application version upgrades. It exports database structure from one database (Source) and merges data from two databases (Source + Target), handling column mismatches, BIGINT precision, and many-to-many junction tables automatically.

**Key Concept**: The tool creates a hybrid SQL export:
- **Structure**: All table schemas come from Source database (new version)
- **Data**: Most data from Source, but specific tables (excludeTables) get their data from Target database (production)
- **Use Case**: Upgrade NocoBase from old version (Target) to new version (Source) while preserving production data

## Core Architecture

### Entry Points
- **Global CLI**: `bin/dbm.js` - Handles command-line arguments, interactive configuration wizard (`--init`), and delegates to merge-export.js
- **Main Logic**: `merge-export.js` - Performs the actual database export and merge operations

### Export Pipeline (4 Steps)

```
Step 0: Auto-detect M2M junction tables
  └─ Query fields table where interface='m2m'
  └─ Parse options JSON → extract 'through' property
  └─ Add junction tables to excludeTables list

Step 1: Export Source database structure + non-excluded data
  └─ mysqldump --no-data (all tables)
  └─ mysqldump --no-create-info --ignore-table (excluded tables)

Step 2: Connect to Target database
  └─ Validate excluded tables exist in both databases

Step 3: Verify and filter excludeTables
  └─ Check table existence in both databases
  └─ Show row counts

Step 4: Export Target data for excluded tables
  └─ mysqldump --no-create-info (only excluded tables)
  └─ Append to output file
```

### Key Technical Features

#### 1. Column Intersection Matching
When Source and Target have different schemas:
```javascript
// Get columns from both databases
sourceColumns = ['id', 'name', 'status', 'new_field']
targetColumns = ['id', 'name', 'status', 'old_field']

// Only export common columns
commonColumns = ['id', 'name', 'status']
```

#### 2. BIGINT Precision Protection
```javascript
// mysql2 connection config
{
  supportBigNumbers: true,
  bigNumberStrings: true  // Returns BIGINT as strings to avoid overflow
}
```

#### 3. DB_UNDERSCORED Table Name Conversion
```javascript
// config.export.dbUnderscored controls table name format
dbUnderscored: true   // userRoles → user_roles (camelCase to snake_case)
dbUnderscored: false  // user_roles → userRoles (snake_case to camelCase)
dbUnderscored: undefined  // No conversion (keep original names)
```

#### 4. M2M Junction Table Auto-Detection
Automatically finds many-to-many relationship junction tables by:
- Querying `fields` table where `interface = 'm2m'`
- Parsing `options` JSON column to extract `through` property
- Adding found tables to excludeTables list with deduplication

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
  "target": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "password",
    "database": "nocobase_prod"
  },
  "export": {
    "excludeTables": ["users", "roles", "approvals"],
    "outputFile": "./merged_export.sql",
    "dbUnderscored": true,
    "removeDefiner": true
  }
}
```

### Preset Table Combinations
- **Preset 1 (Approval)**: 8 workflow/approval tables + their M2M tables
- **Preset 2 (Business)**: Tables from `collections` table + their M2M tables
- **Preset 3 (All)**: Preset 1 + Preset 2 combined
- **Custom**: Manual comma-separated list

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
dbm --help                           # Show help
dbm --version                        # Show version
```

### Testing Database Connection

To test if database connections work before running the full export:
```bash
node -e "const mysql = require('mysql2/promise'); \
  mysql.createConnection({host:'HOST',port:PORT,user:'USER',password:'PASS',database:'DB'}) \
  .then(c => { console.log('✓ Connected'); c.end(); }) \
  .catch(e => console.error('✗ Failed:', e.message));"
```

### Development Workflow for New Features

1. **Modify `merge-export.js`** for core export logic changes
2. **Modify `bin/dbm.js`** for CLI interface changes
3. **Test locally**: `npm link` then `dbm --init` to test as global command
4. **Update CHANGELOG.md** following semantic versioning format
5. **Update README.md** (Chinese primary, English secondary)

## Important Code Patterns

### Error Handling
- Database connection errors immediately exit with `process.exit(1)`
- Table validation errors log warnings but continue (skip non-existent tables)
- mysqldump errors are captured from stderr and thrown as errors

### Character Encoding
All exports use `utf8mb4`:
- mysqldump: `--default-character-set=utf8mb4`
- mysql2: `charset: 'utf8mb4'`
- Output files: UTF-8 encoding with BOM prevention

### SQL Output Format
```sql
-- Header with metadata
-- Source structure + data
-- ============================================================
-- Data from target database for excluded tables
-- ============================================================
-- Table comments with column difference warnings
DELETE FROM `table_name`;
REPLACE INTO `table_name` (`col1`, `col2`) VALUES (...);
```

## Dependencies

- **mysql2**: Database connections with promise support
- **inquirer**: Interactive CLI prompts (v8.2.6)
- **mysqldump**: External command (must be installed separately)

## Testing Notes

**Prerequisites**:
- MySQL/MariaDB client tools installed (`mysqldump` command available)
- Node.js >= 14.0.0
- Access to two databases with similar but not identical schemas

**Common Test Scenarios**:
1. Source and Target on same host (different databases)
2. Tables with column differences between Source and Target
3. Empty excludeTables list (full export)
4. Tables with BIGINT primary keys (>2^53 precision)
5. M2M relationships with junction tables

## Version History Notes

- v1.1.0: Added M2M junction table auto-detection
- v1.0.4: Fixed character encoding issues
- v1.0.3: Performance optimizations
- v1.0.0: Initial release with interactive wizard

## NocoBase-Specific Context

This tool is designed for **NocoBase** (a no-code platform):
- `collections` table stores metadata about business tables
- `fields` table stores field definitions including M2M relationships
- Virtual tables exist in `collections` but not in actual database
- DB_UNDERSCORED env var affects table naming convention
- Workflow/approval tables have complex relationships requiring junction tables
