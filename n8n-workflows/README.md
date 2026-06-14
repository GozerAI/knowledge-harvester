# Archived n8n Workflows (production_line)

These workflow JSON files and the `config.js` were copied from the original
`F:\Projects\Active\production_line\workflows\` directory.

The n8n-based production line has been superseded by the standalone
**content-production** service (`F:\Projects\content-production`, port 8013).
C-Suite now connects to the standalone service via `ContentProductionClient`
(HTTP proxy) rather than orchestrating n8n workflows directly.

## Workflow inventory

| File | Description |
|------|-------------|
| W5_Deep_Research_Engine.json | Deep research engine (+ v2, current, fixed variants) |
| W6_Outline_Generator.json | Ebook outline generator |
| W7_Teaser_Package_Generator.json | Marketing teaser package generator |
| W7B_Design_Applicator.json | Design applicator (+ Simple variant) |
| W9_Chapter_Writer.json | Chapter writer |
| W12_Ebook_Assembler.json | Final ebook assembly |
| W13_Image_Generator.json | Cover and marketing image generation |
| W18_Marketplace_Uploader.json | Upload to marketplaces (Gumroad, Etsy, etc.) |
| config.js | Central configuration (paths, workflow definitions, n8n settings) |

## Why archived

These workflows ran inside a local n8n instance and were triggered by a
Node.js control center. The standalone content-production service reimplements
the full pipeline (research, marketing, image gen, assembly, distribution) in
Python with proper quality gates, revenue tracking, and C-Suite integration.

Archived: 2026-03-22
