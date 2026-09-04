#!/usr/bin/env python3
"""Inline data/au-tax.json into index.html.

The page has to be one self-contained file that works from file:// with no
network requests, so it cannot fetch its tax table at runtime. This script is
the other half of that deal: data/au-tax.json is the source of truth a human
edits, and this copies the parts the engine needs into the AU-TAX-JSON block
in index.html.

    tools/embed.py            rewrite the block from the JSON
    tools/embed.py --check    exit 1 if the page has drifted from the JSON

Only the fields the engine actually reads are inlined. The notes, the sources
and the commentary stay in the JSON file, where they are for people.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, 'data', 'au-tax.json')
HTML_PATH = os.path.join(ROOT, 'index.html')
START = '/* AU-TAX-JSON:start */'
END = '/* AU-TAX-JSON:end */'


def engine_subset(d):
    """The fields index.html reads, in the shape it reads them."""
    ml = d['medicareLevy']
    return {
        'financialYear': d['financialYear'],
        'residentIncomeTax': {
            'brackets': [{'upTo': b['upTo'], 'rate': b['rate']}
                         for b in d['residentIncomeTax']['brackets']],
        },
        'medicareLevy': {
            'rate': ml['rate'],
            'shadeInRate': ml['shadeInRate'],
            'lowerThreshold': {
                'single': ml['lowerThreshold']['single'],
                'family': ml['lowerThreshold']['family'],
            },
        },
        'medicareLevySurcharge': {
            'tiers': [{'tier': t['tier'], 'singleFrom': t['singleFrom'],
                       'familyFrom': t['familyFrom'], 'rate': t['rate']}
                      for t in d['medicareLevySurcharge']['tiers']],
        },
        'lowIncomeTaxOffset': {
            'max': d['lowIncomeTaxOffset']['max'],
            'taper1': d['lowIncomeTaxOffset']['taper1'],
            'taper2': d['lowIncomeTaxOffset']['taper2'],
        },
        'capitalGains': {
            'individualDiscount': d['capitalGains']['individualDiscount'],
        },
        'franking': {
            'companyTaxRate': d['franking']['companyTaxRate'],
        },
    }


def block(subset, fy):
    return (START + '\n'
            'var TAX = ' + json.dumps(subset, separators=(',', ':')) + ';\n'
            + END)


def main():
    check = '--check' in sys.argv[1:]
    with open(JSON_PATH) as fh:
        data = json.load(fh)
    html = open(HTML_PATH).read()

    i, j = html.find(START), html.find(END)
    if i < 0 or j < 0:
        sys.exit('error: %s markers not found in index.html' % START)

    want = block(engine_subset(data), data['financialYear'])
    have = html[i:j + len(END)]

    if have == want:
        print('index.html is in sync with data/au-tax.json (FY %s)' % data['financialYear'])
        return 0
    if check:
        print('index.html has DRIFTED from data/au-tax.json — run tools/embed.py', file=sys.stderr)
        # point at the first difference rather than the first 120 characters,
        # which for a one-line JSON blob are always identical
        at = next((k for k in range(min(len(have), len(want))) if have[k] != want[k]),
                  min(len(have), len(want)))
        lo, hi = max(0, at - 40), at + 40
        print('  at offset %d' % at, file=sys.stderr)
        print('  in the page: ...%s...' % have[lo:hi], file=sys.stderr)
        print('  in the JSON: ...%s...' % want[lo:hi], file=sys.stderr)
        return 1
    open(HTML_PATH, 'w').write(html[:i] + want + html[j + len(END):])
    print('index.html updated from data/au-tax.json (FY %s)' % data['financialYear'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
