#!/usr/bin/env python3
"""Parse Harmony_Tutor_Pannello_Analisi_Testi_v2.html and output JSON with extracted rules."""
from html.parser import HTMLParser
import json, sys, os

class RuleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rules = []
        self.current_rule_id = None
        self.in_code_id = False
        self.in_field_label = False
        self.in_field_content = False
        self.current_field = None
        self.current_text = ''
        self.field_label_text = ''
        self.current_body = ''
        self.current_suggestion = ''

    def handle_starttag(self, tag, attrs):
        classes = dict(attrs).get('class', '')
        if 'code-id' in classes:
            self.in_code_id = True
            self.current_text = ''
        elif 'field-label' in classes:
            self.in_field_label = True
            self.field_label_text = ''
        elif 'field-content' in classes:
            self.in_field_content = True
            self.current_text = ''

    def handle_endtag(self, tag):
        if self.in_code_id:
            self.in_code_id = False
            rid = self.current_text.strip()
            if self.current_rule_id and (self.current_body or self.current_suggestion):
                self.rules.append({
                    'id': self.current_rule_id,
                    'body': self.current_body.strip(),
                    'suggestion': self.current_suggestion.strip()
                })
            self.current_rule_id = rid
            self.current_body = ''
            self.current_suggestion = ''
        elif self.in_field_label:
            self.in_field_label = False
            self.current_field = self.field_label_text.strip().lower()
        elif self.in_field_content:
            self.in_field_content = False
            text = self.current_text.strip()
            if self.current_field and 'dettaglio' in self.current_field:
                self.current_body = text
            elif self.current_field and 'consiglio' in self.current_field:
                self.current_suggestion = text

    def handle_data(self, data):
        if self.in_code_id:
            self.current_text += data
        elif self.in_field_label:
            self.field_label_text += data
        elif self.in_field_content:
            self.current_text += data

    def finish(self):
        if self.current_rule_id and (self.current_body or self.current_suggestion):
            self.rules.append({
                'id': self.current_rule_id,
                'body': self.current_body.strip(),
                'suggestion': self.current_suggestion.strip()
            })

def main():
    html_path = os.path.join(os.path.dirname(__file__), '..', 'docs', 'Harmony_Tutor_Pannello_Analisi_Testi_v2.html')
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()

    p = RuleParser()
    p.feed(html)
    p.finish()

    out_path = os.path.join(os.path.dirname(__file__), '..', 'logs', '_parsed_rules.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(p.rules, f, ensure_ascii=False, indent=2)

    print(f"Extracted {len(p.rules)} rules -> {out_path}")
    for r in p.rules:
        print(f"  {r['id']}: body={len(r['body'])}ch, sugg={len(r['suggestion'])}ch")

if __name__ == '__main__':
    main()
