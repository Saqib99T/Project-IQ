#!/usr/bin/env python3
"""
Convert FEATURES.md to PDF using reportlab
"""

import os
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY

def markdown_to_pdf(md_file, pdf_file):
    """Convert markdown file to PDF"""
    
    # Read the markdown file
    with open(md_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Create PDF document
    doc = SimpleDocTemplate(
        pdf_file,
        pagesize=letter,
        rightMargin=0.75*inch,
        leftMargin=0.75*inch,
        topMargin=0.75*inch,
        bottomMargin=0.75*inch
    )
    
    # Container for PDF elements
    story = []
    
    # Create styles
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1a202c'),
        spaceAfter=30,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    heading1_style = ParagraphStyle(
        'CustomHeading1',
        parent=styles['Heading1'],
        fontSize=16,
        textColor=colors.HexColor('#2d3748'),
        spaceAfter=12,
        spaceBefore=12,
        fontName='Helvetica-Bold'
    )
    
    heading2_style = ParagraphStyle(
        'CustomHeading2',
        parent=styles['Heading2'],
        fontSize=13,
        textColor=colors.HexColor('#4a5568'),
        spaceAfter=10,
        spaceBefore=10,
        fontName='Helvetica-Bold'
    )
    
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['BodyText'],
        fontSize=10,
        textColor=colors.HexColor('#2d3748'),
        spaceAfter=8,
        leading=14,
        alignment=TA_JUSTIFY
    )
    
    # Parse markdown and add to story
    lines = content.split('\n')
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Title (# at beginning)
        if line.startswith('# '):
            title_text = line.replace('# ', '').replace('🚀', '').strip()
            story.append(Paragraph(title_text, title_style))
            story.append(Spacer(1, 0.2*inch))
        
        # Heading 1 (## at beginning)
        elif line.startswith('## '):
            heading_text = line.replace('## ', '').replace('🤖', '').replace('🔌', '').replace('🔧', '').replace('💻', '').replace('🏗️', '').strip()
            story.append(Spacer(1, 0.1*inch))
            story.append(Paragraph(heading_text, heading1_style))
        
        # Heading 2 (### at beginning)
        elif line.startswith('### '):
            heading_text = line.replace('### ', '').replace('**', '').replace('`', '').strip()
            story.append(Spacer(1, 0.08*inch))
            story.append(Paragraph(heading_text, heading2_style))
        
        # Bullet points (* or -)
        elif line.strip().startswith('*') or line.strip().startswith('-'):
            # Handle nested bullets
            indent = (len(line) - len(line.lstrip())) // 4
            bullet_text = line.strip()[1:].strip().replace('**', '').replace('`', '')
            bullet_indent = '&nbsp;' * (indent * 4)
            story.append(Paragraph(f"{bullet_indent}• {bullet_text}", body_style))
        
        # Horizontal rule
        elif line.strip() == '---':
            story.append(Spacer(1, 0.1*inch))
            story.append(Paragraph('_' * 80, body_style))
            story.append(Spacer(1, 0.1*inch))
        
        # Regular paragraph
        elif line.strip() and not line.startswith('```'):
            para_text = line.strip().replace('**', '').replace('`', '')
            if para_text:
                story.append(Paragraph(para_text, body_style))
        
        # Code blocks
        elif line.strip().startswith('```'):
            # Skip code blocks for now
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                i += 1
        
        # Empty lines
        elif not line.strip():
            story.append(Spacer(1, 0.05*inch))
        
        i += 1
    
    # Build PDF
    try:
        doc.build(story)
        print(f"✅ PDF created successfully: {pdf_file}")
        return True
    except Exception as e:
        print(f"❌ Error creating PDF: {e}")
        return False

if __name__ == "__main__":
    md_path = "docs/FEATURES.md"
    pdf_path = "docs/FEATURES.pdf"
    
    if os.path.exists(md_path):
        markdown_to_pdf(md_path, pdf_path)
    else:
        print(f"❌ File not found: {md_path}")
