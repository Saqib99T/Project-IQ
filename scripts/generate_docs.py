import markdown
import os

# Configuration
INPUT_FILE = r"d:\99T\Rasa\Project-IQ\docs\FEATURES.md"
OUTPUT_FILE = r"d:\99T\Rasa\Project-IQ\docs\Features_Report.html"

# Enhanced CSS for Print-Ready PDF feeling
CSS_STYLE = """
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono&display=swap');

    body {
        font-family: 'Inter', sans-serif;
        line-height: 1.6;
        color: #1f2937;
        max-width: 850px;
        margin: 40px auto;
        padding: 0 40px;
        background-color: #ffffff;
    }
    
    h1, h2, h3 {
        color: #111827;
        margin-top: 1.5em;
        margin-bottom: 0.8em;
    }
    
    h1 {
        font-size: 2.5em;
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 0.3em;
        text-align: center;
        color: #2563eb;
    }

    h2 {
        font-size: 1.8em;
        border-bottom: 1px solid #e5e7eb;
        padding-bottom: 0.2em;
        color: #1f2937;
    }

    h3 {
        font-size: 1.3em;
        color: #4b5563;
    }

    code {
        font-family: 'JetBrains Mono', monospace;
        background-color: #f3f4f6;
        padding: 0.2em 0.4em;
        border-radius: 4px;
        font-size: 0.9em;
        color: #dc2626;
    }

    pre {
        background-color: #1f2937;
        color: #f9fafb;
        padding: 1.5em;
        border-radius: 8px;
        overflow-x: auto;
    }

    pre code {
        background-color: transparent;
        color: inherit;
        padding: 0;
    }

    ul {
        margin-left: 1.5em;
    }

    li {
        margin-bottom: 0.4em;
    }

    hr {
        border: 0;
        height: 1px;
        background: #e5e7eb;
        margin: 3em 0;
    }

    blockquote {
        background-color: #f0f9ff;
        border-left: 4px solid #0ea5e9;
        margin: 1.5em 0;
        padding: 1em;
        color: #0c4a6e;
    }

    @media print {
        body {
            max-width: 100%;
            margin: 0;
            padding: 20px;
        }
        h1 { color: #000; }
        a { text-decoration: none; color: #000; }
        pre, code { border: 1px solid #ccc; }
    }
</style>
"""

def generate_html_report():
    print(f"Reading markdown from: {INPUT_FILE}")
    
    try:
        with open(INPUT_FILE, "r", encoding="utf-8") as f:
            text = f.read()

        # Convert Markdown to HTML
        html_content = markdown.markdown(text, extensions=['fenced_code', 'tables', 'nl2br'])

        # Create full HTML document
        full_document = f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Project IQ - Features Report</title>
            {CSS_STYLE}
        </head>
        <body>
            {html_content}
            <div style="margin-top: 50px; font-size: 0.8em; text-align: center; color: #9ca3af; border-top: 1px solid #eee; padding-top: 20px;">
                Generated automatically by Project IQ Documentation Engine
            </div>
        </body>
        </html>
        """

        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write(full_document)
            
        print(f"✅ Report successfully generated at: {OUTPUT_FILE}")
        
    except FileNotFoundError:
        print(f"❌ Error: Could not find input file: {INPUT_FILE}")
    except Exception as e:
        print(f"❌ An error occurred: {e}")

if __name__ == "__main__":
    generate_html_report()
