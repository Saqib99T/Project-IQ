#!/usr/bin/env python3
"""
Convert EXTERNAL_LIBRARIES_AND_TOOLS.md to PDF using reportlab
Enhanced version with better formatting, tables, and code blocks
"""

import os
import re
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Preformatted, KeepTogether
)
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY

def clean_text(text):
    """Clean markdown formatting from text"""
    # Remove bold
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'__(.*?)__', r'\1', text)
    # Remove code backticks but keep content
    text = re.sub(r'`(.*?)`', r'\1', text)
    # Remove emojis and special chars
    text = text.replace('📦', '').replace('🎯', '').replace('🚀', '').replace('⚙️', '')
    text = text.replace('🌐', '').replace('🔐', '').replace('🗄️', '').replace('🔌', '')
    text = text.replace('📊', '').replace('🧠', '').replace('💾', '').replace('📄', '')
    text = text.replace('🐳', '').replace('🎭', '').replace('📝', '').replace('💻', '')
    text = text.replace('⚡', '').replace('🔍', '').replace('📘', '')
    return text.strip()

def markdown_to_pdf(md_file, pdf_file):
    """Convert markdown file to PDF with proper formatting"""
    
    with open(md_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    doc = SimpleDocTemplate(
        pdf_file,
        pagesize=letter,
        rightMargin=0.6*inch,
        leftMargin=0.6*inch,
        topMargin=0.6*inch,
        bottomMargin=0.6*inch,
        title='Project IQ - External Libraries and Tools'
    )
    
    story = []
    styles = getSampleStyleSheet()
    
    # Define custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1a202c'),
        spaceAfter=6,
        spaceBefore=0,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    subtitle_style = ParagraphStyle(
        'Subtitle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#666666'),
        spaceAfter=20,
        alignment=TA_CENTER,
        fontName='Helvetica'
    )
    
    heading1_style = ParagraphStyle(
        'CustomHeading1',
        parent=styles['Heading1'],
        fontSize=14,
        textColor=colors.HexColor('#1a202c'),
        spaceAfter=8,
        spaceBefore=12,
        fontName='Helvetica-Bold',
        borderColor=colors.HexColor('#2d3748'),
        borderWidth=2,
        borderPadding=8,
        backColor=colors.HexColor('#f0f4f8')
    )
    
    heading2_style = ParagraphStyle(
        'CustomHeading2',
        parent=styles['Heading2'],
        fontSize=12,
        textColor=colors.HexColor('#2d3748'),
        spaceAfter=6,
        spaceBefore=8,
        fontName='Helvetica-Bold'
    )
    
    heading3_style = ParagraphStyle(
        'CustomHeading3',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor('#4a5568'),
        spaceAfter=4,
        spaceBefore=4,
        fontName='Helvetica-Bold'
    )
    
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#2d3748'),
        spaceAfter=6,
        leading=13,
        alignment=TA_JUSTIFY
    )
    
    bullet_style = ParagraphStyle(
        'Bullet',
        parent=styles['Normal'],
        fontSize=9.5,
        textColor=colors.HexColor('#2d3748'),
        spaceAfter=4,
        leading=12,
        leftIndent=20,
        bulletIndent=10
    )
    
    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontSize=9,
        fontName='Helvetica-Bold',
        textColor=colors.whitesmoke,
        alignment=TA_CENTER
    )
    
    table_body_style = ParagraphStyle(
        'TableBody',
        parent=styles['Normal'],
        fontSize=8.5,
        textColor=colors.HexColor('#2d3748'),
        alignment=TA_LEFT,
        leading=10
    )
    
    # Parse markdown
    lines = content.split('\n')
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Title (# at beginning)
        if line.startswith('# '):
            title_text = clean_text(line.replace('# ', ''))
            story.append(Paragraph(title_text, title_style))
            
        # Subtitle (next line after title)
        elif line.startswith('**Document') or line.startswith('**Version') or line.startswith('**Application'):
            story.append(Paragraph(clean_text(line), subtitle_style))
            
        # Heading 1 (## at beginning)
        elif line.startswith('## '):
            heading_text = clean_text(line.replace('## ', ''))
            story.append(Spacer(1, 0.12*inch))
            story.append(Paragraph(heading_text, heading1_style))
            
        # Heading 2 (### at beginning)
        elif line.startswith('### '):
            heading_text = clean_text(line.replace('### ', ''))
            story.append(Spacer(1, 0.08*inch))
            story.append(Paragraph(heading_text, heading2_style))
            
        # Heading 3 (#### at beginning)
        elif line.startswith('#### '):
            heading_text = clean_text(line.replace('#### ', ''))
            story.append(Spacer(1, 0.05*inch))
            story.append(Paragraph(heading_text, heading3_style))
            
        # Code blocks
        elif line.strip().startswith('```'):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i])
                i += 1
            
            if code_lines:
                code_text = '\n'.join(code_lines)
                story.append(Spacer(1, 0.05*inch))
                try:
                    preformatted = Preformatted(
                        code_text,
                        ParagraphStyle(
                            'Code',
                            parent=styles['Normal'],
                            fontSize=7.5,
                            fontName='Courier',
                            textColor=colors.HexColor('#1f2937'),
                            backColor=colors.HexColor('#f5f5f5'),
                            leftIndent=10,
                            rightIndent=10,
                            borderColor=colors.HexColor('#cccccc'),
                            borderWidth=1,
                            borderPadding=5,
                            leading=9
                        )
                    )
                    story.append(preformatted)
                except:
                    story.append(Paragraph(f"<font face='Courier' size='8'>{code_text}</font>", body_style))
                story.append(Spacer(1, 0.08*inch))
            
        # Table rows (markdown tables with |)
        elif line.strip().startswith('|'):
            table_rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [c.strip() for c in lines[i].split('|')[1:-1]]
                table_rows.append(cells)
                i += 1
            i -= 1  # Back up one line
            
            if table_rows and len(table_rows) > 1:
                # Skip separator row if present
                if all(c.strip() in ['---', ':--', '--:', ':--:'] for c in table_rows[1] if c):
                    table_rows = [table_rows[0]] + table_rows[2:]
                
                # Convert cells to paragraphs for better formatting
                formatted_rows = []
                for row_idx, row in enumerate(table_rows):
                    formatted_row = []
                    for cell in row:
                        cell_text = clean_text(cell)
                        if row_idx == 0:
                            formatted_row.append(Paragraph(cell_text, table_header_style))
                        else:
                            formatted_row.append(Paragraph(cell_text, table_body_style))
                    formatted_rows.append(formatted_row)
                
                try:
                    # Calculate column widths
                    num_cols = len(formatted_rows[0])
                    col_width = 7.3 * inch / num_cols
                    
                    table = Table(formatted_rows, colWidths=[col_width] * num_cols)
                    table.setStyle(TableStyle([
                        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2d3748')),
                        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                        ('FONTSIZE', (0, 0), (-1, 0), 9),
                        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
                        ('TOPPADDING', (0, 0), (-1, 0), 8),
                        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f9fafb')),
                        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
                        ('FONTSIZE', (0, 1), (-1, -1), 8),
                        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#f9fafb'), colors.white]),
                        ('TOPPADDING', (0, 1), (-1, -1), 5),
                        ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
                    ]))
                    story.append(Spacer(1, 0.05*inch))
                    story.append(table)
                    story.append(Spacer(1, 0.1*inch))
                except Exception as e:
                    print(f"Table error: {e}")
        
        # Bullet points
        elif line.strip().startswith('- ') or line.strip().startswith('* '):
            indent = len(line) - len(line.lstrip())
            bullet_text = clean_text(line.strip()[2:])
            
            if bullet_text:
                para = Paragraph(f"• {bullet_text}", bullet_style)
                story.append(para)
        
        # Horizontal rule
        elif line.strip() == '---':
            story.append(Spacer(1, 0.08*inch))
            story.append(Paragraph('_' * 60, body_style))
            story.append(Spacer(1, 0.08*inch))
        
        # Page break indicator
        elif '---' in line and len([c for c in line if c == '-']) > 5:
            story.append(PageBreak())
        
        # Regular paragraph
        elif line.strip() and not any(line.strip().startswith(s) for s in ['```', '|', '#', '**', '***', '> ']):
            para_text = clean_text(line.strip())
            if para_text and len(para_text) > 2:
                story.append(Paragraph(para_text, body_style))
        
        # Empty lines
        elif not line.strip():
            story.append(Spacer(1, 0.04*inch))
        
        i += 1
    
    # Build PDF
    try:
        doc.build(story)
        print(f"✅ PDF created successfully: {pdf_file}")
        return True
    except Exception as e:
        print(f"❌ Error creating PDF: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    md_path = "EXTERNAL_LIBRARIES_AND_TOOLS.md"
    pdf_path = "EXTERNAL_LIBRARIES_AND_TOOLS_v2.pdf"
    
    if os.path.exists(md_path):
        markdown_to_pdf(md_path, pdf_path)
    else:
        print(f"❌ File not found: {md_path}")
