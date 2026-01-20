"""
PowerPoint Generator for Project IQ Presentation
Generates a professional presentation from markdown content.

Requirements:
    pip install python-pptx

Usage:
    python generate_ppt.py
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import re

# Color Scheme - Modern Purple Theme
COLORS = {
    'primary': RGBColor(124, 58, 237),      # Purple
    'secondary': RGBColor(79, 70, 229),     # Indigo
    'accent': RGBColor(16, 185, 129),       # Green
    'dark': RGBColor(31, 41, 55),           # Dark Gray
    'light': RGBColor(249, 250, 251),       # Light Gray
    'white': RGBColor(255, 255, 255),
}


def add_title_slide(prs, title, subtitle):
    """Add title slide with gradient-like background."""
    slide_layout = prs.slide_layouts[6]  # Blank
    slide = prs.slides.add_slide(slide_layout)
    
    # Background shape
    shape = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(0), Inches(0),
        prs.slide_width, prs.slide_height
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = COLORS['primary']
    shape.line.fill.background()
    
    # Title
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(2.5), Inches(9), Inches(1.5))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(44)
    p.font.bold = True
    p.font.color.rgb = COLORS['white']
    p.alignment = PP_ALIGN.CENTER
    
    # Subtitle
    sub_box = slide.shapes.add_textbox(Inches(0.5), Inches(4), Inches(9), Inches(1))
    tf = sub_box.text_frame
    p = tf.paragraphs[0]
    p.text = subtitle
    p.font.size = Pt(24)
    p.font.color.rgb = COLORS['light']
    p.alignment = PP_ALIGN.CENTER
    
    return slide


def add_content_slide(prs, title, content_lines):
    """Add content slide with bullet points."""
    slide_layout = prs.slide_layouts[6]  # Blank
    slide = prs.slides.add_slide(slide_layout)
    
    # Header bar
    header = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(0), Inches(0),
        prs.slide_width, Inches(1.2)
    )
    header.fill.solid()
    header.fill.fore_color.rgb = COLORS['primary']
    header.line.fill.background()
    
    # Title
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(9), Inches(0.7))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(32)
    p.font.bold = True
    p.font.color.rgb = COLORS['white']
    
    # Content
    content_box = slide.shapes.add_textbox(Inches(0.5), Inches(1.5), Inches(9), Inches(5.5))
    tf = content_box.text_frame
    tf.word_wrap = True
    
    for i, line in enumerate(content_lines):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        
        # Clean the line
        clean_line = line.strip()
        if clean_line.startswith(('- ', '• ', '* ')):
            clean_line = clean_line[2:]
        if clean_line.startswith(('🎫', '📋', '🔍', '✏️', '📎', '📚', '📊', '⭐', '✅', '🔜', '🌍', '🏢', '📱', '🔔', '📈', '🤖')):
            p.level = 0
        else:
            p.level = 0
            
        p.text = clean_line
        p.font.size = Pt(18)
        p.font.color.rgb = COLORS['dark']
        p.space_after = Pt(12)
    
    return slide


def add_table_slide(prs, title, headers, rows):
    """Add slide with table."""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)
    
    # Header bar
    header = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(0), Inches(0),
        prs.slide_width, Inches(1.2)
    )
    header.fill.solid()
    header.fill.fore_color.rgb = COLORS['primary']
    header.line.fill.background()
    
    # Title
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(9), Inches(0.7))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(32)
    p.font.bold = True
    p.font.color.rgb = COLORS['white']
    
    # Table
    cols = len(headers)
    table = slide.shapes.add_table(
        len(rows) + 1, cols,
        Inches(0.5), Inches(1.5),
        Inches(9), Inches(0.5 * (len(rows) + 1))
    ).table
    
    # Header row
    for i, header_text in enumerate(headers):
        cell = table.cell(0, i)
        cell.text = header_text
        cell.fill.solid()
        cell.fill.fore_color.rgb = COLORS['secondary']
        p = cell.text_frame.paragraphs[0]
        p.font.bold = True
        p.font.size = Pt(14)
        p.font.color.rgb = COLORS['white']
    
    # Data rows
    for row_idx, row in enumerate(rows):
        for col_idx, cell_text in enumerate(row):
            cell = table.cell(row_idx + 1, col_idx)
            cell.text = str(cell_text)
            p = cell.text_frame.paragraphs[0]
            p.font.size = Pt(12)
            p.font.color.rgb = COLORS['dark']
    
    return slide


def generate_presentation():
    """Generate the Project IQ presentation."""
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)
    
    # Slide 1: Title
    add_title_slide(
        prs,
        "Project IQ - IT Support Chatbot",
        "AI-Powered Conversational Interface for GLPI Ticketing"
    )
    
    # Slide 2: What is Project IQ
    add_content_slide(prs, "What is Project IQ?", [
        "🎫 Create Tickets - Natural language ticket creation",
        "📋 View & Track - Real-time ticket status and history",
        "🔍 Knowledge Base - Search articles before creating tickets",
        "📊 Analytics - Comprehensive conversation analytics",
        "🛠️ Admin Dashboard - Full management suite",
    ])
    
    # Slide 3: Core Features
    add_table_slide(prs, "Core Features (Completed ✅)", 
        ["Feature", "Description"],
        [
            ["🎫 Create Tickets", "Natural language → GLPI ticket"],
            ["📋 List Tickets", "View all open/closed tickets"],
            ["🔍 Check Status", "Real-time ticket lookup"],
            ["✏️ Update Tickets", "Add comments, change status"],
            ["📎 File Attachments", "Upload files to tickets"],
            ["📚 KB Search", "Search before ticket creation"],
            ["📊 Charts", "Visual ticket statistics"],
            ["⭐ Ratings", "1-5 star feedback collection"],
        ]
    )
    
    # Slide 4: Admin Dashboard
    add_content_slide(prs, "Admin Dashboard (Completed ✅)", [
        "📊 Analytics - Conversations, messages, feedback metrics",
        "🔍 Inspector - Real-time conversation debugging",
        "🎨 Themes - Visual customization with live preview",
        "⚙️ Configuration - GLPI and widget settings",
        "🔎 Chat Filters - User, App, Status, Date filters",
        "📈 Charts - Intent distribution, feedback breakdown",
    ])
    
    # Slide 5: Observability & Studio
    add_content_slide(prs, "Observability & Studio (Completed ✅)", [
        "📡 Real-Time Monitoring - Rasa Core, Action Server, Database",
        "📝 Log Viewer - Filtered log analysis with search",
        "🚀 One-Click Training - Train models from dashboard",
        "✏️ NLU Editor - View/edit training intents",
        "📖 Stories & Rules - Visualize conversation flows",
        "💬 Response Editor - Edit bot responses",
    ])
    
    # Slide 6: Future Roadmap
    add_table_slide(prs, "Future Roadmap with AI Effort",
        ["Feature", "AI Effort", "Priority"],
        [
            ["🌍 Multi-Lingual Support", "~8 hours", "High"],
            ["🏢 Multi-Tenant Architecture", "~22 hours", "High"],
            ["📱 Mobile Widget", "~4 hours", "Medium"],
            ["🔔 Push Notifications", "~3 hours", "Medium"],
            ["📈 Advanced Analytics", "~5 hours", "Low"],
            ["🤖 AI Intent Suggestions", "~6 hours", "Low"],
        ]
    )
    
    # Slide 7: Multi-Lingual Details
    add_table_slide(prs, "Multi-Lingual Implementation (~8 hours)",
        ["Phase", "Time", "Details"],
        [
            ["NLU Training Data", "2 hours", "German & French intents"],
            ["Response Templates", "1.5 hours", "Localized responses"],
            ["Language Detection", "1 hour", "Auto-detect language"],
            ["Widget Localization", "1.5 hours", "UI translation"],
            ["Admin Dashboard", "1 hour", "Dashboard i18n"],
            ["Testing & Polish", "1 hour", "QA and fixes"],
        ]
    )
    
    # Slide 8: Multi-Tenant Details
    add_table_slide(prs, "Multi-Tenant Implementation (~22 hours)",
        ["Phase", "Time", "Details"],
        [
            ["Database & Core", "4 hours", "Tenant isolation"],
            ["Authentication", "3 hours", "Multi-tenant auth"],
            ["API Updates", "3 hours", "Tenant-aware APIs"],
            ["Admin Dashboard", "4 hours", "Tenant management UI"],
            ["Widget & Frontend", "2 hours", "Tenant branding"],
            ["Operations", "3 hours", "Usage tracking"],
            ["Testing & Polish", "3 hours", "Security review"],
        ]
    )
    
    # Slide 9: AI Development Speed
    add_table_slide(prs, "Traditional vs AI-Assisted Development",
        ["Task", "Traditional", "AI-Assisted", "Speedup"],
        [
            ["Multi-Lingual Support", "3-4 weeks", "8 hours", "10x"],
            ["Multi-Tenant Architecture", "7-8 weeks", "22 hours", "12x"],
            ["Admin Dashboard Features", "2-3 weeks", "6 hours", "15x"],
            ["Chat History Filters", "1 week", "2 hours", "20x"],
        ]
    )
    
    # Slide 10: Tech Stack
    add_table_slide(prs, "Technology Stack",
        ["Layer", "Technology"],
        [
            ["AI/NLU", "Rasa Open Source 3.6"],
            ["Backend", "Python, Flask"],
            ["Database", "PostgreSQL 18"],
            ["Frontend", "React, TailwindCSS"],
            ["Charts", "Chart.js"],
            ["Integration", "GLPI REST API"],
            ["Deployment", "Nginx, Docker"],
        ]
    )
    
    # Slide 11: Summary
    add_content_slide(prs, "Summary & Key Takeaways", [
        "✅ Complete GLPI Integration - Full ticket lifecycle",
        "✅ Smart AI Understanding - 30+ intents, entity extraction",
        "✅ Modern Admin Dashboard - Analytics, Inspector, Studio",
        "✅ Production Ready - PostgreSQL, Nginx, Error handling",
        "🔜 Coming Soon - Multi-lingual, Multi-tenant, Mobile",
        "",
        "🚀 10x+ Development Speed with AI Agent Assistance",
    ])
    
    # Save
    output_path = r"d:\99T\Rasa\Project-IQ\Project_IQ_Chatbot_Updated.pptx"
    prs.save(output_path)
    print(f"Presentation saved to: {output_path}")
    return output_path


if __name__ == "__main__":
    generate_presentation()
