# Maestro JavaScript Reference

Use this for `evalScript`, `runScript`, inline expressions, generated data, shared state, and JavaScript logging.

## Execution Methods

Maestro supports three JavaScript paths:

1. Inline `${...}` expressions inside YAML command values.
2. `evalScript` for short logic-only steps.
3. `runScript` for external `.js` files with reusable or complex logic.

```yaml
- inputText: ${'User_' + faker.name().firstName()}
- evalScript: ${output.timestamp = new Date().getTime()}
- runScript:
    file: setupUser.js
    env:
      role: admin
```

## Shared State

Use `output` for data shared between scripts and later flow steps.

```yaml
- evalScript: ${output.email = 'qa_' + Date.now() + '@example.com'}
- inputText: ${output.email}
```

Keep output values small and non-secret. Do not put tokens, raw PII, or credentials into logs or artifact reports.

## Script Env

```yaml
- runScript:
    file: setupUser.js
    env:
      userRole: admin
```

```javascript
const role = userRole;
console.log('Setting up role: ' + role);
```

## Logging

`console.log` output is captured in `maestro.log` with a JavaScript console prefix. `maestro.log` belongs to `--debug-output`, not `--test-output-dir`, unless both flags point at the same directory.

Limitations from official docs:

- Multiple `console.log` arguments are not supported; concatenate or use template literals in external files.
- Template literals do not work inside `evalScript` the way they do in external `.js` files because `evalScript` already uses `${...}` syntax.

```yaml
- evalScript: '${console.log("Value: " + output.email)}'
```

## When To Use JS

Use JS for:

- generated test data
- lightweight derived values
- setup/teardown API calls when the repo already permits them
- assertions via `assertTrue`
- reusable selector constants when the repository has that convention

Avoid JS when a native Maestro command is clearer. Keep helpers deterministic and committed with the flow when they are part of the test contract.
