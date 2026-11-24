#!/usr/bin/env python3
"""Generates tests/fixtures/sample.xlsx and sample.docx with hand-written minimal OOXML."""
import os, zipfile

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(here, exist_ok=True)
D, S = zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED

CT_X = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        '</Types>')
RELS_X = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
          '</Relationships>')
WB = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      '<sheets><sheet name="Questions" sheetId="1" r:id="rId1"/></sheets></workbook>')
WB_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
           '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
           '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
           '</Relationships>')
strings = ['Question', 'Correct', 'Wrong 1', 'Wrong 2', 'Fact',            # 0-4
           'Capital of France?', 'Paris', 'Berlin', 'Madrid',              # 5-8
           'Tom & Jerry?', 'Cat &amp; mouse']                               # 9-10 (9 plain, 10 holds a literal entity-looking text)
# shared string 11 is a rich-text string (two runs)
SST = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
       '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="12" uniqueCount="12">'
       + ''.join('<si><t>%s</t></si>' % s.replace('&', '&amp;') if s != 'Cat &amp; mouse' else '<si><t>Cat &amp;amp; mouse</t></si>' for s in strings)
       + '<si><r><t xml:space="preserve">Rich </t></r><r><rPr><b/></rPr><t>text?</t></r></si>'
       '</sst>')
# Row 1 header (A..E). Row 2: normal. Row 3: inline strings with a gap (no Wrong 2 / cell C missing) -> alignment test.
# Row 5: rich text question, number answer.
SHEET = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
         '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
         '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>'
         '<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" t="s"><v>7</v></c><c r="D2" t="s"><v>8</v></c></row>'
         '<row r="3"><c r="A3" t="inlineStr"><is><t>Largest planet?</t></is></c><c r="B3" t="inlineStr"><is><t>Jupiter</t></is></c>'
         '<c r="D3" t="inlineStr"><is><t>Mars</t></is></c><c r="E3" t="inlineStr"><is><r><t>Gas </t></r><r><t>giant</t></r></is></c></row>'
         '<row r="4"/>'
         '<row r="5"><c r="A5" t="s"><v>11</v></c><c r="B5"><v>42</v></c><c r="C5" t="b"><v>1</v></c></row>'
         '<row r="6"><c r="B6" t="s"><v>6</v></c></row>'
         '<row r="7"><c r="A7" t="s"><v>9</v></c><c r="B7" t="s"><v>10</v></c><c r="C7" t="s"><v>7</v></c></row>'
         '</sheetData></worksheet>')
with zipfile.ZipFile(os.path.join(here, 'sample.xlsx'), 'w') as z:
    z.writestr('[Content_Types].xml', CT_X, S)      # stored on purpose (method 0)
    z.writestr('_rels/.rels', RELS_X, D)
    z.writestr('xl/workbook.xml', WB, D)
    z.writestr('xl/_rels/workbook.xml.rels', WB_RELS, D)
    z.writestr('xl/sharedStrings.xml', SST, D)
    z.writestr('xl/worksheets/sheet1.xml', SHEET, D)

# ---------------------------------------------------------------- DOCX
CT_D = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>')
RELS_D = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
          '</Relationships>')
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def run(t, b=False, b_off=False):
    rpr = ''
    if b:
        rpr = '<w:rPr><w:b/></w:rPr>'
    elif b_off:
        rpr = '<w:rPr><w:b w:val="0"/></w:rPr>'
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (rpr, esc(t))


def para(*runs, num=False):
    ppr = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' if num else ''
    return '<w:p>%s%s</w:p>' % (ppr, ''.join(runs))


body = ''.join([
    para(run('Family Trivia')),                                   # title: bare line, should be skipped
    para(run('1. What is the capital of Switzerland?')),
    para(run('A) Zurich')),
    para(run('B) '), run('Bern', b=True)),                        # bold run = correct
    para(run('C) Geneva')),
    para(run('Fact: Bern is called the federal city.')),
    para(run('2. Which are mammals?', b=True)),                    # wholly bold question line
    para(run('A) Whale', b=True)),
    para(run('B) Shark', b_off=True)),                             # explicitly NOT bold
    para(run('Answer: A')),
    para(run('3. Largest ocean?')),
    para(run('Atlantic'), num=True),                               # list paragraphs => "- " choices
    para(run('Pacific', b=True), num=True),
    para(run('Indian'), num=True),
    para(run('4. Name a primary color.')),
    para(run('Answer: Blue')),
])
DOC = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document %s><w:body>%s<w:sectPr/></w:body></w:document>' % (W, body))
with zipfile.ZipFile(os.path.join(here, 'sample.docx'), 'w') as z:
    z.writestr('[Content_Types].xml', CT_D, D)
    z.writestr('_rels/.rels', RELS_D, D)
    z.writestr('word/document.xml', DOC, D)


def tc(t):
    return '<w:tc><w:tcPr/>%s</w:tc>' % para(run(t))


def tr(*cells):
    return '<w:tr>%s</w:tr>' % ''.join(tc(c) for c in cells)


tbl = '<w:tbl><w:tblPr/>%s</w:tbl>' % ''.join([
    tr('Question', 'Correct', 'Wrong 1', 'Wrong 2'),
    tr('What colour is the sky?', 'Blue', 'Green', 'Red'),
    tr('Who wrote Hamlet?', 'Shakespeare', 'Dickens', 'Austen'),
])
DOC2 = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document %s><w:body>%s<w:sectPr/></w:body></w:document>' % (W, para(run('Quiz table')) + tbl))
with zipfile.ZipFile(os.path.join(here, 'table.docx'), 'w') as z:
    z.writestr('[Content_Types].xml', CT_D, D)
    z.writestr('_rels/.rels', RELS_D, D)
    z.writestr('word/document.xml', DOC2, D)
print('fixtures written to', here)
