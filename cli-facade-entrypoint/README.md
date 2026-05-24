# @expo98/cli-facade-entrypoint

Modernized process-level CLI facade for expo98.

This package owns the small boundary that legacy code handled around
`main(process.argv.slice(2))`:

- parse raw argv
- store the latest parsed CLI output options
- delegate to command dispatch
- on process-level failure, write an error using the latest known options
- return the classified process exit code

The parser, argument projection, dispatch, handlers, and IO are injected so this
facade can compose the other transformed packages without duplicating them.

## Verification

```bash
npm test
```

