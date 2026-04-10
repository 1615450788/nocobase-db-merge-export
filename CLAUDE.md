# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**nocobase-db-merge-export** (dbm) is a specialized CLI tool for NocoBase application version upgrades. It exports pure configuration data from a single database (Source) while excluding business data, generating a SQL patch file that truncates and overwrites tables in a target database.

**Key Concept**: 
- **Goal**: Export configuration data only (no structure)
- **Data**: All configuration tables from Source get their data exported via `mysqldump --no-create-info`
- **Exclusion**: Business tables (excludeTables) and their M2M junction tables are completely ignored
- **Overwrite**: Generated SQL includes `TRUNCATE TABLE` statements before inserts to safely overwrite old configuration data without leaving dirty data behind

## Development Commands

### Running the Tool
```bash
# Development mode (local)
node merge-export.js                  # Use ./config.json
node merge-export.js ./custom.json    # Use custom config
npm run export                        # npm script alias

# Global mode (after npm link)
dbm                                   # Use ./config.json
dbm ./custom.json                     # Use custom config
dbm --init                           # Interactive wizard
dbm --help, -h                       # Show help
dbm --version, -v                    # Show version
```

### Testing
```bash
npm test                              # Runs node merge-export.js config.json (requires valid config)
node test-mysql.js                    # Basic MySQL connection test (no dependencies)
```

### Installation for Development
```bash
npm install                           # Install dependencies
npm link                              # Make dbm command available globally for testing
```

### Git Ignored Files
- `config.json` - Database credentials (never commit)
- `*.sql` - Export files (generated artifacts)
- `node_modules/` - Dependencies
- IDE files (`.vscode/`, `.idea/`)
- OS metadata (`.DS_Store`, `Thumbs.db`)

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

#### 4. Business Table Detection
- **Preset Tables**: Hardcoded list of approval/workflow tables (`PRESET_TABLES.approval` in `bin/dbm.js`)
- **Dynamic Detection**: Queries `collections` table to find all user-defined business tables
- **Combination**: Can combine preset and dynamic tables via interactive wizard

#### 5. Virtual Table Filtering
Automatically skips views (VIEWs) by querying `information_schema.tables` with `table_type = 'BASE TABLE'`.

#### 6. mysqldump Integration
- Uses `--single-transaction` for consistency
- `--no-create-info` to exclude table structures
- `--complete-insert` for explicit column names
- Password passed via `MYSQL_PWD` environment variable

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

### Interactive Configuration Wizard
Run `dbm --init` to generate config interactively:
- Database connection details
- Business table selection (preset, dynamic, custom, or combined)
- DB_UNDERSCORED setting (true/false/auto)
- Automatic timestamp addition to output filename

### Environment Variables and Command Line Arguments
Configuration can be provided via environment variables or command line arguments, eliminating the need for config.json.

#### Environment Variables
- `DB_HOST` - Database host (default: 127.0.0.1)
- `DB_PORT` - Database port (default: 3306)
- `DB_USER` - Database user (default: root)
- `DB_PASSWORD` - Database password
- `DB_NAME` - Database name (required)
- `DB_EXCLUDE_TABLES` - Comma-separated list of tables to exclude (optional - if not provided, business tables will be dynamically read from the `collections` table at runtime, plus preset approval environment data tables)
- `DB_OUTPUT_FILE` - Output SQL file path
- `DB_UNDERSCORED` - Table name conversion: "true", "false", or unset for auto

#### Command Line Arguments
- `--host` - Database host
- `--port` - Database port
- `--user` - Database user
- `--password` - Database password
- `--database` - Database name (required)
- `--exclude-tables` - Comma-separated list of tables to exclude (optional - if not provided, business tables will be dynamically read from the `collections` table at runtime, plus preset approval environment data tables)
- `--output-file` - Output SQL file path
- `--db-underscored` - true/false/auto

#### Usage Examples
```bash
# Interactive mode (no config file)
dbm

# Command line arguments
dbm --host localhost --database nocobase --user root --password 123456

# Environment variables
DB_HOST=localhost DB_NAME=nocobase dbm

# Config file (legacy)
dbm config.json
```

#### Priority Order
1. Command line arguments
2. Environment variables
3. Config file (config.json)
4. Interactive prompts (for missing required values)

## Common Development Tasks

### Adding New Preset Table Combinations
1. Edit `PRESET_TABLES` object in `bin/dbm.js` (line ~17)
2. Update the wizard choices in `initConfig()` function
3. Update documentation in `README.md` and `README.en.md`

### Modifying Export Logic
1. Edit `merge-export.js` functions:
   - `exportConfigurationData()`: mysqldump parameters and chunking
   - `getConfigTables()`: table filtering logic
   - `getM2MJunctionTables()`: M2M detection
2. Test with a local database using `npm run export`

### CLI Interface Changes
1. Edit `bin/dbm.js`:
   - `showHelp()`: Update help text
   - `initConfig()`: Modify wizard questions
   - Argument parsing in `main()`
2. Test with `npm link` and `dbm --init`

### Testing Database Connections
Use `test-mysql.js` as a simple connection test. Requires manual modification for your database credentials.

## Dependencies

- **mysql2**: Database connections with promise support
- **inquirer**: Interactive CLI prompts (v8.2.6)
- **mysqldump**: External command (must be installed separately via system package manager)

## Notes

- No build step required - pure Node.js source
- No linting or formatting configuration
- Tests are minimal; focus on integration testing with actual databases
- Chinese documentation is primary (`README.md`), English is secondary (`README.en.md`)