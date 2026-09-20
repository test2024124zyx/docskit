from pathlib import Path
import hashlib

markdown = Path('markdown.js')
text = markdown.read_text(encoding='utf-8')
before = '    decodedPath = pathPart.split("/").map((segment) => {'
after = r'''    const unescapedPath = pathPart.replace(/\\(.)/g, (match, character) => ESCAPABLE_CHARACTERS.has(character) ? character : match);
    decodedPath = unescapedPath.split("/").map((segment) => {'''
assert text.count(before) == 1
markdown.write_text(text.replace(before, after), encoding='utf-8')

unit = Path('test/server-unit.test.js')
data = unit.read_bytes()
actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
assert actual == '07758c7f581ee207d2b22e257786f29b79262630', actual
text = data.decode('utf-8')
for before in [
    '  const frontendScript = fs.readFileSync(path.join(PROJECT_DIR, "script.js"), "utf8");\n',
    r'''  assert.match(frontendScript, /lineNodes\.map\(\(line\) => line\.textContent\)\.join\("\\n"\)/);''' + '\n'
]:
    assert text.count(before) == 1, before
    text = text.replace(before, '')
# The replacement is covered by the new real-DOM lazy-highlight regression test.
unit.write_text(text, encoding='utf-8')

regression = Path('test/review-regressions.test.js')
with regression.open('a', encoding='utf-8') as out:
    out.write(r'''

test("Markdown 转义括号与 URL 编码可以组合使用", () => {
  const target = markdown.markdownTarget("assets/file\\(v1\\)%20copy.md", "guide/index.md", "document");
  assert.equal(target.docPath, "guide/assets/file(v1) copy.md");
  const result = markdown.renderMarkdown("[guide]: assets/file\\(v1\\).md\n\n[guide]", "guide/index.md");
  assert.match(result.html, /data-doc-path="guide\/assets\/file\(v1\)\.md"/);
});
''')
print('Preserved Markdown punctuation escapes and replaced implementation-specific assertion with DOM coverage')
