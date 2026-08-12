#!/usr/bin/env bash

set -u

API_BASE_URL="${VOICEFLOW_API_BASE_URL:-https://realtime-http-api.empyrean.voiceflow.com/v1alpha1}"
JWT=""

usage() {
    printf 'Usage: %s\n\n' "${0##*/}"
    printf 'Copy a Voiceflow project between workspaces. The source and destination\n'
    printf 'identifiers and JWT are requested interactively.\n\n'
    printf 'Environment:\n'
    printf '  VOICEFLOW_API_BASE_URL  Override the default API base URL\n\n'
    printf 'Options:\n'
    printf '  -h, --help              Show this help text\n'
}

cleanup() {
    JWT=""
}
trap cleanup EXIT HUP INT TERM

case "${1:-}" in
    -h|--help)
        usage
        exit 0
        ;;
    "")
        ;;
    *)
        printf 'Error: unknown option: %s\n\n' "$1" >&2
        usage >&2
        exit 2
        ;;
esac

printf 'Source assistant/version ID: '
IFS= read -r source_id
printf 'Destination workspace ID: '
IFS= read -r workspace_id
printf 'Destination folder ID: '
IFS= read -r folder_id
printf 'JWT: '
IFS= read -r -s JWT
printf '\n'

if [[ -z "$source_id" || -z "$workspace_id" || -z "$folder_id" || -z "$JWT" ]]; then
    printf 'Error: all four values are required.\n' >&2
    exit 2
fi

# The source ID is part of an output filename, so reject path separators.
if [[ "$source_id" == */* || "$source_id" == *$'\n'* ]]; then
    printf 'Error: source assistant/version ID must not contain a path separator.\n' >&2
    exit 2
fi

export_file="voiceflow-export-${source_id}.json"
import_timestamp="$(printf '%(%Y%m%d-%H%M%S)T' -1)"
import_file="voiceflow-import-result-${import_timestamp}.json"

get_status=""
if ! get_status="$(curl --silent --show-error \
    --request GET \
    --header "Authorization: Bearer ${JWT}" \
    --header 'Cache-Control: no-cache' \
    --output "$export_file" \
    --write-out '%{http_code}' \
    "${API_BASE_URL}/assistant/export-json/${source_id}")"; then
    printf 'Error: export request failed (curl could not complete the request).\n' >&2
    exit 1
fi

if [[ ! "$get_status" =~ ^2[0-9][0-9]$ ]]; then
    printf 'Error: export request returned HTTP %s.\n' "$get_status" >&2
    printf '%s\n' "$(<"$export_file")" >&2
    exit 1
fi

printf 'Export saved to: %s\n' "$export_file"

post_status=""
if ! post_status="$(curl --silent --show-error \
    --request POST \
    --header "Authorization: Bearer ${JWT}" \
    --form "file=@${export_file}" \
    --form 'targetSchemaVersion=13.1' \
    --form "folderID=${folder_id}" \
    --output "$import_file" \
    --write-out '%{http_code}' \
    "${API_BASE_URL}/assistant/import-file/${workspace_id}")"; then
    printf 'Error: import request failed (curl could not complete the request).\n' >&2
    exit 1
fi

if [[ ! "$post_status" =~ ^2[0-9][0-9]$ ]]; then
    printf 'Error: import request returned HTTP %s.\n' "$post_status" >&2
    printf '%s\n' "$(<"$import_file")" >&2
    exit 1
fi

printf 'Import response saved to: %s\n' "$import_file"
printf 'Import response:\n%s\n' "$(<"$import_file")"
