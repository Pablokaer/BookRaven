import { zip } from "./helpers.js";

// A small EPUB: three chapters around an image in the spine (which KOReader gives no
// DocFragment), with nested elements, entities, mixed content, a comment, CDATA, <pre>,
// a namespaced SVG and source line breaks inside paragraphs.

export const CH1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>One</title>
</head>
<body>
  <h1 id="c1">Chapter One</h1>
  <p>It was a &quot;dark&quot; &amp; stormy night; the rain fell in torrents.</p>
  <p>Except at <i>occasional</i> intervals, when it was <b>checked by a <em>violent</em> gust</b> of wind.</p>
  <p class="x">Caf&#233; &#8212; na&#xEF;ve text,
     spread over
     three lines.</p>
</body>
</html>
`;

export const CH2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:svg="http://www.w3.org/2000/svg">
<head><title>Two</title><link rel="stylesheet" href="s.css"/></head>
<body id="b2">
<section epub:type="chapter">
  <div class="a">
    <p>First <span>nested <span>deeper</span> text</span> after.</p>
    <p>Second paragraph<!-- a comment --> continues here.</p>
  </div>
  <div class="b">
    <blockquote><p>Quoted words.</p></blockquote>
    <pre>  line one
    line two</pre>
    <p><b>Bold</b> <i>italic</i> plain.</p>
    <p><![CDATA[Raw <cdata> text]]> and more.</p>
    <svg:svg width="10" height="10"><svg:title>pic</svg:title></svg:svg>
    <p id="last">Last one.</p>
  </div>
</section>
</body>
</html>
`;

export const CH3 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Three</title></head>
<body>
<p>
   Indented start of the end.</p>
<table><tr><td>Cell A</td><td>Cell B</td></tr></table>
</body>
</html>
`;

export const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:positions</dc:identifier>
    <dc:title>Positions</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="pic" href="images/pic.svg" media-type="image/svg+xml"/>
    <item id="ch2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="pic"/>
    <itemref idref="ch2" id="ch2ref"/>
    <itemref idref="ch3"/>
  </spine>
</package>
`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`;

export function fixtureEpub() {
  return zip([
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`, true],
    ["OEBPS/content.opf", OPF, true],
    ["OEBPS/text/ch1.xhtml", CH1, true],
    ["OEBPS/images/pic.svg", SVG],
    ["OEBPS/text/ch 2.xhtml", CH2, true],
    ["OEBPS/text/ch3.xhtml", CH3],
  ]);
}
