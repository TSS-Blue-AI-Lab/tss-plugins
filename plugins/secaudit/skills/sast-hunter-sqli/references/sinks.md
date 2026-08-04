# SQLi — Recon Sink Catalog

Find every location where a SQL query is constructed in a vulnerable way — string
concatenation, interpolation, or formatting with any variable (regardless of origin).
Flag ANY dynamic variable embedded into the query; do not yet decide whether it is
user-controlled (that is the verify phase's job).

## Vulnerable query-construction patterns

1. **String concatenation into a SQL execution call**:
   - `cursor.execute("SELECT ... WHERE id = " + var)`
   - `$pdo->query("SELECT * FROM users WHERE id = " . $var)`
   - `jdbcTemplate.query("SELECT * WHERE username = '" + var + "'")`

2. **F-strings / template literals used as a query argument**:
   - `cursor.execute(f"SELECT * WHERE name = '{var}'")`
   - `` db.query(`SELECT * WHERE id = ${var}`) ``
   - `db.QueryRow(fmt.Sprintf("SELECT * WHERE id = '%s'", var))`

3. **String formatting functions used to build the query**:
   - `cursor.execute("SELECT * WHERE id = %s" % var)` (note: `%` formatting, NOT parameterized binding)
   - `cursor.execute("SELECT * WHERE id = {}".format(var))`
   - `String.format("SELECT * WHERE id = '%s'", var)` (Java)
   - `sprintf("SELECT * WHERE id = %s", $var)` (PHP)

4. **ORM raw/unsafe methods called with a dynamically built string** (not a static template with bound params):
   - Django: `Model.objects.raw(f"...")`, `RawSQL(f"...")`, `extra(where=[f"..."])`
   - ActiveRecord: `where("col = '#{var}'")`  (Ruby interpolation inside string arg)
   - Sequelize: `` sequelize.query(`...${var}...`) ``, `literal(var)`
   - TypeORM: `` createQueryBuilder().where(`col = '${var}'`) ``, `.query("..." + var)`
   - Prisma: `$queryRawUnsafe(...)`, `$executeRawUnsafe(...)`
   - Entity Framework: `FromSqlRaw("..." + var)`, `ExecuteSqlRaw("..." + var)`

5. **Dynamic identifiers** — any variable used as a column name, table name, `ORDER BY` / `GROUP BY` value in a query string (parameterization cannot protect identifiers; only allowlist validation can):
   - `f"SELECT * FROM {table_var}"`
   - `` `SELECT * FROM ${tableVar}` ``
   - `f"SELECT * ORDER BY {sort_col}"`

## What to skip (safe — do not flag)

- Static query strings with no dynamic parts: `cursor.execute("SELECT * FROM users WHERE id = %s", (val,))`
- ORM safe query builder methods: `.filter()`, `.where(col: val)`, `.findOne()`, `.findUnique()`, `prisma.$queryRaw` with tagged template literals
- Properly parameterized raw queries where the string itself is static and values are passed as a separate argument list: `execute("SELECT * WHERE id = %s", (val,))`, `query("SELECT * WHERE id = ?", [val])`

## Recon output — record each candidate as

```markdown
# SQLi Recon: [Project Name]

## Summary
Found [N] locations where SQL queries are constructed in a vulnerable way.

## Vulnerable Construction Sites

### 1. [Descriptive name — e.g., "String concat in get_user query"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / endpoint**: [function name or route]
- **Query execution method**: [cursor.execute / db.query / raw / etc.]
- **Construction pattern**: [string concat / f-string / template literal / % format / .format() / fmt.Sprintf / ORM raw]
- **Interpolated variable(s)**: `var_name` — [brief note on what it appears to represent, e.g., "looks like a sort column" or "unknown origin"]
- **Code snippet**:
  ```
  [the vulnerable query construction + execution call]
  ```

[Repeat for each site]
```
