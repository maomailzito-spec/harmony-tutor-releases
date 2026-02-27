            const ornOverrideLookaheadRoman = (): string => {
                try {
                    if (!(ornamentOverrides || []).length) return '';
                    // Build keys from USER overrides only (not auto-detected)
                    const userOvKeys = new Set<string>();
                    for (const o of (ornamentOverrides || []) as any[]) {
                        if (!o?.noteId || !o?.type || o.type === 'structural') continue;
                        userOvKeys.add(o.noteId);
                        if (o.midi != null && o.measureIndex != null && o.beat != null)
                            userOvKeys.add(`${o.midi}-${o.measureIndex}-${o.beat}`);
                    }
                    if (!userOvKeys.size) return '';
                    // Remove ONLY user-overridden notes, keep auto-detected ornaments
                    const userFiltered = (fullNotes || []).filter((n: any) => {
                        if (!n || n.isRest) return true;
                        if (n.id && userOvKeys.has(n.id)) return false;
                        const midi = Number(n.midi);
                        if (Number.isFinite(midi) && userOvKeys.has(`${midi}-${n.measureIndex ?? -1}-${n.beat ?? -1}`)) return false;
                        return true;
                    });
                    const pcs = new Set(userFiltered.filter((n: any) => n && !n.isRest && Number.isFinite(n.midi)).map((n: any) => ((n.midi % 12) + 12) % 12));
                    // Try chord from remaining notes directly
                    if (pcs.size >= 2) {
                        const r = getRomanAnalysis(userFiltered as any, contextTonic, contextIsMinor);
                        if (r?.roman) return String(r.roman);
                    }
                    // Look-ahead: add notes from next beat for missing PCs
                    if (pcs.size < 3) {
                        const curIdx = (timelineFiltered || []).findIndex((e: any) => Math.abs(Number(e?.absBeat) - Number(event.absBeat)) < 1e-6);
                        const nextEv = curIdx >= 0 ? (timelineFiltered || [])[curIdx + 1] : null;
                        if (nextEv?.notes) {
                            let augmented = [...userFiltered];
                            for (const nn of (nextEv.notes as any[])) {
                                if (!nn || nn.isRest || !Number.isFinite(nn.midi)) continue;
                                const nnPc = ((nn.midi % 12) + 12) % 12;
                                if (!pcs.has(nnPc)) { augmented.push(nn); pcs.add(nnPc); break; }
                            }
                            if (augmented.length > userFiltered.length) {
                                const rAug = getRomanAnalysis(augmented as any, contextTonic, contextIsMinor);
                                if (rAug?.roman) return String(rAug.roman);
                            }
                        }
                    }
                    return '';
                } catch { return ''; }
            };