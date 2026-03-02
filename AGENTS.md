# nocobase-db-merge-export Agent Guide

Welcome, Agent. This document provides the guidelines, commands, and conventions for working autonomously in the `nocobase-db-merge-export` (dbm) repository. Please adhere to these rules strictly to ensure consistency, safety, and maintainability.

## 1. Environment & Architecture

**nocobase-db-merge-export** is a Node.js CLI tool designed to assist with NocoBase application version upgrades. It creates a hybrid SQL export by taking the database structure from a Source (new version) and selectively merging data from a Target (production old version) for specified tables.

- **Stack**: Node.js (>=14.0.0), plain JavaScript (CommonJS).
- **Core Dependencies**: `mysql2` (promises API), `inquirer` (for the CLI wizard).
- **External Dependencies**: Requires `mysqldump` to be installed on the system environment.
- **Entry Points**: 
  - `bin/dbm.js`: Global CLI, interactive configuration wizard.
  - `merge-export.js`: Main operational logic for database connections and SQL dump generation.

For deeper architecture understanding (Export Pipeline, Table Name Conversion, M2M Detection), please review the `CLAUDE.md` file.

## 2. Build, Lint, and Test Commands

There is no complex build step, transpilation (no TypeScript, Babel, or Webpack), or formal testing framework (like Jest or Mocha) in this project. Everything runs natively in Node.js.

### Execution & Testing

Because there is no test framework, "running a single test" generally involves creating a specific JSON configuration file to test a single edge case (e.g., specific tables, M2M resolutions) and running the export logic against it.

- **Run Standard Export**:
  ```bash
  node merge-export.js
  ```
  *(Uses `./config.json` by default)*

- **Run with Custom Config (Integration Test)**:
  To test a specific scenario, create a targeted config and pass it as an argument:
  ```bash
  node merge-export.js path/to/custom-test-config.json
  ```
  Alternatively, you can use the npm alias:
  ```bash
  npm test
  ```
  *(Note: this alias just runs `node merge-export.js config.json`)*

- **Test Database Connection Manually**:
  To quickly verify database connectivity before running a full export, use this one-liner:
  ```bash
  node -e "const mysql = require('mysql2/promise'); \
    mysql.createConnection({host:'HOST',port:3306,user:'USER',password:'PASS',database:'DB'}) \
    .then(c => { console.log('✓ Connected'); c.end(); }) \
    .catch(e => console.error('✗ Failed:', e.message));"
  ```

- **Global CLI Testing**:
  To test the global CLI wrapper locally (including `inquirer` prompts):
  ```bash
  npm link
  dbm --init
  ```

### Linting
No formal linter (ESLint) or formatter (Prettier) is configured in the repository. Please rely on visual inspection and adhere tightly to the code style guidelines outlined below.

## 3. Code Style Guidelines

### 3.1. Language & Module System
- **Language**: Pure JavaScript (Node.js). Do not introduce TypeScript.
- **Module System**: Use CommonJS (`require` and `module.exports`). **Do not use ES Modules (`import`/`export`).**

### 3.2. Formatting
- **Indentation**: 4 spaces strictly. Do not use 2 spaces or tabs.
- **Semicolons**: Mandatory. Always use semicolons at the end of statements.
- **Quotes**: Use single quotes (`'`) for string literals, and template literals (`` ` ``) for string interpolation or multi-line strings.
- **Comments**: Use standard JSDoc `/** ... */` for function headers describing parameters and returns, and `//` for inline explanations.

### 3.3. Naming Conventions
- **Variables & Functions**: `camelCase` (e.g., `loadConfig`, `getBusinessTables`).
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `PRESET_TABLES`).
- **File Names**: `kebab-case` (e.g., `merge-export.js`).
- **Database Tables**: Depending on the `DB_UNDERSCORED` configuration, table names may flip between `camelCase` and `snake_case`. Always use the `convertTableName` or `convertTableNames` utility functions when handling table names.

### 3.4. Imports
- Group Node.js core modules first (e.g., `path`, `fs`), followed by third-party packages (e.g., `mysql2`, `inquirer`), and finally local requires.
- Use `fs.promises` instead of standard `fs` for asynchronous file operations.

```javascript
// Example import block
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

const mysql = require('mysql2/promise');
const inquirer = require('inquirer');
```

### 3.5. Error Handling
- **Async/Await**: Use `async`/`await` combined with `try...catch` blocks for all asynchronous operations, particularly database queries, file reads, and shell spawns.
- **Fail Fast**: For critical errors (e.g., configuration loading failure, Source database connection refusal), log the error and immediately exit the process using `process.exit(1)`.
- **Soft Failures**: For non-critical errors (e.g., a missing table during an optional check), log a warning but allow the export process to continue.
- **Logging conventions**: Use structured console outputs with specific emojis for immediate visual clarity:
  - `console.log('🔍 ...')` for information or scanning progress.
  - `console.log('✓ ...')` for successes.
  - `console.error('✗ ...')` for hard errors.
  - `console.warn('⚠️ ...')` for soft warnings.

### 3.6. SQL & Database Interactions
- **Query Parameterization**: Always use parameterized queries or placeholders (`?`) in `mysql2` to prevent SQL injection and properly escape user/table strings.
- **Character Set**: Ensure `charset: 'utf8mb4'` is explicitly passed when creating database connections.
- **BIGINT Protection**: Always configure `mysql2` with `supportBigNumbers: true` and `bigNumberStrings: true` to prevent JavaScript precision loss on BIGINT columns (like primary keys).

### 3.7. Subprocesses (mysqldump)
- Use `spawn` from `child_process` to execute `mysqldump`. Do not use `exec` to avoid buffer limits.
- Capture `stderr` streams explicitly to handle any `mysqldump` errors, and ensure the Promise resolves only when the `close` event fires with exit code `0`.
- Pass `--default-character-set=utf8mb4` on all `mysqldump` invocations.

## 4. Repository Workflows

- **Core Logic**: Modify `merge-export.js` when altering the export/merge engine, file parsing, or database queries.
- **CLI Interaction**: Modify `bin/dbm.js` when altering command-line arguments, `--init` behavior, or `inquirer` prompts.
- **Documentation**: If adding new functionality, always update `CHANGELOG.md` following semantic versioning, and update both `README.md` (Chinese, primary) and `README.en.md` (English, secondary).

*End of AGENTS.md*