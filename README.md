[![test][testimg]][testurl]

# ndocs

[nodejs docs][ndocs] summariser
so your [bot][llm] doesn't drown

**Requirements:**

- Node.js >=22

```sh
npm i -g nicholaswmin/ndocs
```

## usage

```sh
ndocs - skim node docs, expand as needed

USAGE
  ndocs <module[.method]> [...]

EXAMPLES
  ndocs list                        # list all modules
  ndocs completion                  # zsh completion script
  ndocs assert                      # concise module docs
  ndocs assert.strictEqual          # specific method only
  ndocs assert.ok assert.fail       # multiple methods
  ndocs assert --full               # full module docs
  ndocs assert -n 22                # docs for Node v22
  ndocs assert --stats              # size comparison

OPTIONS
  --nodev/-n    node version (default: latest)
  --full/-f     return all fields
  --stats/-s    show size stats
  --help/-h     show this help

ENV
  NO_COLOR      No ANSI output
```

**workflow:**

1. list all modules
2. check module methods
3. focus on specifics, *only*

### filtering

pipe `--full` output to [jq][jq]:

```sh
# deprecated APIs
ndocs process --full | jq '[.. | objects | select(.stability == 0)] | .[]'

# experimental APIs
ndocs fs --full | jq '[.. | objects | select(.stability == 1)] | .[] | .name'

# etc...
```

## test

```sh
npm test
```

## development

```sh
npm link      # link globally in dev
npm unlink    # unlink globally
```

## license

[nicholaswmin][authurl] - 2025 - [MIT License][license]

[testimg]: https://github.com/nicholaswmin/ndocs/actions/workflows/test.yml/badge.svg
[testurl]: https://github.com/nicholaswmin/ndocs/actions/workflows/test.yml
[ndocs]: https://nodejs.org/api
[llm]: https://en.wikipedia.org/wiki/Large_language_model
[jq]: https://jqlang.github.io/jq/
[authurl]: https://github.com/nicholaswmin
[license]: https://opensource.org/licenses/MIT
