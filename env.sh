# Source this in each terminal you use for the walkthrough:
#
#   source ./env.sh
#
# It gives the appshell CLI, and the dev servers that run on it, a config and credentials of
# their own in .appshell/ here. So nothing in this demo reads or changes ~/.appshell, which may
# point at another registry, such as the hosted one.

_appshell_demo="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"

export APPSHELL_CONFIG="$_appshell_demo/.appshell/config"
export APPSHELL_CREDENTIALS="$_appshell_demo/.appshell/credentials"

unset _appshell_demo
