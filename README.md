# claude-code-status-line

A Claude Code mod that shows one line under the prompt:

```
verke │ Opus 5.5 │ ctx ▰▰▱▱▱▱▱▱  21% │ 5h ▰▰▱▱▱  35% ↻ 14:20 / wk ▰▰▰▱▱  51% ⇥ Wed 19:54 ↻ Sat 01:00
```

| Segment | Meaning |
|---|---|
| `verke` | Last folder of the directory you started Claude Code in (`~` for your home folder) |
| `Opus 5.5` | Active model (`1M` added when the extended context window is on) |
| `ctx` | How full the context window is |
| `5h` / `wk` | How much of your 5-hour and weekly limits you have used |
| `↻ 14:20` | When that limit resets, in your local time zone, 24h clock. A weekday is added when the reset is on another day |
| `⇥ Wed 19:54` | Only shown when you are on pace to use the whole limit before it resets: the time you would run out |

Colours: green under 50%, yellow from 50%, orange from 75%, bold red from 90% (context: 50 / 65 / 80%). You get one toast per window when a limit passes 90%.

Run `/quota` to show details above the prompt: the full project path, longer bars, time-zone name, time left until each reset, and the pace forecast in words. Run `/quota` again to hide them.

## How it works

It is a plugin of function hooks (a "mod"), not a `statusLine` script. The figures come from what Claude Code already receives with each reply, so the mod makes no network calls and never reads your credentials.

The pace forecast is a straight-line projection: the share of the limit used so far divided by the share of the window that has passed. It stays hidden for the first 10% of a window, where the estimate is too noisy.

## Install

In Claude Code:

```
/plugin marketplace add mikljohansson/claude-code-status-line
/plugin install status-line@claude-code-status-line
```

Or clone the repository and start Claude Code with `claude --plugin-dir <path to the clone>`.

Requirements:

- A Claude Code build with function-hook plugins (developed on 2.1.289). This plugin API is early access and may change between releases.
- A Pro or Max plan for the 5h and weekly figures. With an API key those segments are left out.

## Settings

Both appear in `/config` under the plugin:

- **Time zone**: an IANA zone such as `Europe/Berlin`. Empty uses the system zone.
- **Weekday names**: `en` (Mon) or `de` (Mo).

## Development

```
claude plugin validate .
claude plugin test .
```

## Credits

Inspired by [TahaSabir0/Best-ClaudeCode-statusline](https://github.com/TahaSabir0/Best-ClaudeCode-statusline) (the segment layout and colour levels) and [anantraghunath/claude-code-usage-quota-mod](https://github.com/anantraghunath/claude-code-usage-quota-mod) (the pace forecast and the 90% warning).

## License

MIT
