#!/bin/zsh
# Rimisura il generatore sull'elenco di brani passato in $1, stadio per stadio.
SC="$1"
F=(); while IFS= read -r l; do F+=("$l"); done < "$SC"
riga() {
  local eti="$1"; shift
  local r; r=$(env "$@" npx tsx scripts/banco-corali.ts "${F[@]}" 2>&1)
  local err avv orig
  err=$(echo "$r" | grep TOTALE | sed 's/.*generatore: \([0-9]*\).*/\1/')
  orig=$(echo "$r" | grep TOTALE | sed 's/.*originali: \([0-9]*\).*/\1/')
  avv=$(echo "$r" | grep "generatore  " | awk '{s+=$5} END {print s}')
  local cond; cond=$(echo "$r" | grep CONDOTTA | sed 's/CONDOTTA generatore: //')
  printf '%-30s %5s errori %5s avvisi   %s   (autori: %s)\n' "$eti" "$err" "$avv" "$cond" "$orig"
}
riga "$2" "${@:3}"
