# ManageFile terminal

Sign in, then click **Terminal** at the top right. You can also right-click a
folder or the file area and choose **Open terminal here**. Commands run on the
server computer. The terminal starts in that folder and remembers `cd` changes.

## Windows

The terminal uses Windows PowerShell and requires an elevated ManageFile process.
Stop any existing ManageFile server, then run `start-admin.ps1` locally on the
server and approve the normal Windows UAC prompt. The script starts `app.py` with
the current Python installation in administrator mode. It never bypasses UAC or
changes the execution policy. If ManageFile is already elevated, no restart is
needed. A non-elevated server displays instructions and rejects terminal commands.
The current application port is 2289. `MANAGEFILE_PORT` overrides that port.

## Ubuntu / Linux

Start `python app.py` normally. The terminal uses Bash with the current server
user's permissions and does not automatically invoke `sudo` or elevate privileges.

## Behavior

The terminal requires the existing JWT login and CSRF token. Commands stop after
60 seconds, at login expiration, on **Stop**, or when that session signs out.
Each login session runs at most one command at a time. Output is limited to the
last 64 KB. Commands use isolated non-interactive shell processes, so the working
folder is preserved while shell variables, interactive programs and long-running
background jobs are not retained. Password prompts are not supported. Closing
the panel leaves its active command running until it finishes or reaches its limit.

The existing trusted-account file manager now permits arbitrary shell commands
under the server account (Administrator when started elevated on Windows).

Validation: `python -m unittest -v test_auth test_terminal`.
