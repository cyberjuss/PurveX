"""
PDF Report Generator for PurveX Detection Effectiveness Reports

Generates enterprise-grade PDF reports similar to Nessus reports,
providing evidence-based answers to SOC, detection engineering, and executive stakeholders.
"""

import uuid
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pathlib import Path
import os

# Guard the optional dependency import so reloader failures don't surface as NameError.
colors = None
try:
    from reportlab.lib import colors as rl_colors
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

    colors = rl_colors
    REPORTLAB_AVAILABLE = True

    # Color scheme matching PurveX branding
    COLORS = {
        "primary": colors.HexColor("#4F46E5"),  # Indigo
        "secondary": colors.HexColor("#7C3AED"),  # Purple
        "success": colors.HexColor("#10B981"),  # Emerald
        "warning": colors.HexColor("#F59E0B"),  # Amber
        "danger": colors.HexColor("#EF4444"),  # Red
        "info": colors.HexColor("#3B82F6"),  # Blue
        "dark": colors.HexColor("#1F2937"),  # Slate
        "light": colors.HexColor("#F3F4F6"),  # Slate light
        "border": colors.HexColor("#E5E7EB"),  # Slate border
    }
    STATUS_PALETTE = {
        "HEALTHY": ("Healthy", "#059669"),
        "DETECTION_FAILED": ("Failed", "#DC2626"),
        "TELEMETRY_MISSING": ("Telemetry Gap", "#D97706"),
        "UNKNOWN": ("Pending Validation", "#6B7280"),
    }
    RESULT_PALETTE = {
        "PASS": "#059669",
        "FAIL": "#DC2626",
        "INCONCLUSIVE": "#D97706",
    }
except ImportError:
    REPORTLAB_AVAILABLE = False
    COLORS = {}
    STATUS_PALETTE = {}
    RESULT_PALETTE = {}

def derive_health_state(detection: Dict[str, Any]) -> str:
    """Derive health state from detection data."""
    if not detection.get("last_tested_at"):
        return "UNKNOWN"
    
    result = (detection.get("last_result") or "").upper()
    if result == "PASS":
        return "HEALTHY"
    elif result == "FAIL":
        return "DETECTION_FAILED"
    elif result == "INCONCLUSIVE":
        return "TELEMETRY_MISSING"
    return "UNKNOWN"


def calculate_health_score(detections: List[Dict[str, Any]]) -> int:
    """Calculate overall health score (0-100) based on detection states."""
    if not detections:
        return 0
    
    healthy = sum(1 for d in detections if derive_health_state(d) == "HEALTHY")
    total_tested = sum(1 for d in detections if d.get("last_tested_at"))
    
    if total_tested == 0:
        return 0
    
    # Weight: Healthy = 100, Failed = 30, Missing telemetry = 20, Unknown = 0
    score = 0
    for d in detections:
        state = derive_health_state(d)
        if state == "HEALTHY":
            score += 100
        elif state == "DETECTION_FAILED":
            score += 30
        elif state == "TELEMETRY_MISSING":
            score += 20
        # UNKNOWN adds 0
    
    return int(score / len(detections))


def get_mitre_coverage(detections: List[Dict[str, Any]], mitre_techniques: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate MITRE ATT&CK coverage metrics."""
    # Map technique_id to detection
    detected_techniques = {d.get("technique_id", "").upper() for d in detections if d.get("technique_id")}
    
    # Group by tactic
    tactics_map: Dict[str, Dict[str, Any]] = {}
    
    for tech in mitre_techniques:
        tech_id = tech.get("id", "").upper()
        tactics = tech.get("tactics", [])
        
        for tactic in tactics:
            if tactic not in tactics_map:
                tactics_map[tactic] = {
                    "total": 0,
                    "validated": 0,
                    "claimed": 0,
                    "techniques": []
                }
            
            tactics_map[tactic]["total"] += 1
            tactics_map[tactic]["techniques"].append({
                "id": tech_id,
                "name": tech.get("name", ""),
                "has_detection": tech_id in detected_techniques,
                "is_validated": tech_id in detected_techniques and any(
                    d.get("technique_id", "").upper() == tech_id and d.get("last_result") == "PASS"
                    for d in detections
                )
            })
            
            if tech_id in detected_techniques:
                tactics_map[tactic]["claimed"] += 1
                # Check if validated (has PASS result)
                if any(
                    d.get("technique_id", "").upper() == tech_id and d.get("last_result") == "PASS"
                    for d in detections
                ):
                    tactics_map[tactic]["validated"] += 1
    
    return tactics_map


def generate_pdf_report(
    report_data: Dict[str, Any],
    output_path: str,
    organization_name: str = "PurveX Organization"
) -> str:
    """
    Generate a comprehensive PDF report.
    
    Args:
        report_data: Dictionary containing all report data
        output_path: Path where PDF should be saved
        organization_name: Name of the organization
    
    Returns:
        Path to generated PDF file
    """
    if not REPORTLAB_AVAILABLE:
        raise ImportError("reportlab is required for PDF generation. Install with: pip install reportlab")
    
    # Ensure output directory exists
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=0.75*inch,
        leftMargin=0.75*inch,
        topMargin=0.75*inch,
        bottomMargin=0.75*inch
    )
    
    story = []
    styles = getSampleStyleSheet()
    report_period_text = f"{report_data.get('start_date', 'N/A')} to {report_data.get('end_date', 'N/A')}"
    environments_text = ', '.join(report_data.get('environments', [])) or 'N/A'
    report_id_text = report_data.get('report_id', 'N/A')
    generated_at_text = report_data.get('generated_at', 'N/A')
    
    body_style = ParagraphStyle(
        'Body',
        parent=styles['BodyText'],
        fontSize=9,
        leading=12,
        textColor=COLORS["dark"],
    )
    hero_text_style = ParagraphStyle(
        'HeroText',
        parent=styles['BodyText'],
        fontSize=14,
        textColor=COLORS["dark"],
        leading=18,
        spaceAfter=6,
        fontName='Helvetica-Bold'
    )
    section_heading_style = ParagraphStyle(
        'SectionHeading',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=COLORS["primary"],
        spaceAfter=4,
        spaceBefore=10,
        fontName='Helvetica-Bold'
    )
    subheading_style = ParagraphStyle(
        'Subheading',
        parent=styles['Heading4'],
        fontSize=11,
        textColor=COLORS["dark"],
        spaceAfter=3,
        fontName='Helvetica-Bold'
    )
    caption_style = ParagraphStyle(
        'Caption',
        parent=styles['Normal'],
        fontSize=8,
        textColor=COLORS["dark"],
        spaceAfter=2,
    )
    def build_header_block() -> Paragraph:
        text = "<b>PurveX · Detection Effectiveness Report</b> · <font color='#6b7280'>DRAFT · No Validations</font>"
        return Paragraph(text, hero_text_style)

    def build_divider() -> Table:
        line = Table([['']], colWidths=[6.5*inch], rowHeights=0.08*inch)
        line.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 0.6, COLORS['border']),
        ]))
        return line

    def build_summary_cards() -> Table:
        tests = report_data.get('tests', [])
        pass_count = sum(1 for t in tests if (t.get('result') or '').upper() == 'PASS')
        pass_rate = int((pass_count / len(tests)) * 100) if tests else None
        healthy_count = report_data.get('healthy_count', 0)

        def kpi_value(label: str):
            if label == "Detection Health":
                if tests:
                    score = report_data.get('overall_health_score')
                    return f"{score}/100" if score is not None else "—"
                return "—"
            if label == "Tests Executed":
                count = len(tests)
                return str(count)
            if label == "Pass Rate":
                if pass_rate is not None:
                    return f"{pass_rate}%"
                return "—"
            if label == "Detections":
                total = report_data.get('total_detections', 0)
                return str(total) if total is not None else "—"
            return "—"

        stats = [
            ('Detection Health', COLORS['primary']),
            ('Tests Executed', COLORS['info']),
            ('Pass Rate', COLORS['success']),
            ('Detections', COLORS['secondary']),
        ]

        card_cells = []
        for label, color_value in stats:
            value = kpi_value(label)
            card_cells.append(Paragraph(
                f"<font size=7 color='#64748b'>{label.upper()}</font><br/><font size=20>{value}</font>",
                body_style
            ))

        table = Table([card_cells], colWidths=[1.6*inch]*4)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.white),
            ('BOX', (0, 0), (-1, -1), 0.6, COLORS['border']),
            ('INNERGRID', (0, 0), (-1, -1), 0.4, COLORS['border']),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('TEXTCOLOR', (0, 0), (-1, -1), COLORS['dark']),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ]))
        return table

    def build_health_breakdown_table() -> Table:
        detections = report_data.get('detections', [])
        healthy_count = report_data.get('healthy_count', 0)
        failed_count = report_data.get('failed_count', 0)
        untested_count = report_data.get('untested_count', 0)
        telemetry_count = sum(1 for d in detections if derive_health_state(d) == "TELEMETRY_MISSING")
        total = max(report_data.get('total_detections', len(detections)) or 0, 1)

        def pct(value: int) -> str:
            return f"{int((value / total) * 100)}%"

        rows = [
            ['Status', 'Count', '%'],
            ['Healthy', str(healthy_count), pct(healthy_count)],
            ['Failed', str(failed_count), pct(failed_count)],
            ['Telemetry Gap', str(telemetry_count), pct(telemetry_count)],
            ['Pending', str(untested_count), pct(untested_count)],
        ]
        table = Table(rows, colWidths=[2.8*inch, 1.0*inch, 2.3*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['light']),
            ('TEXTCOLOR', (0, 0), (-1, 0), COLORS['dark']),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.25, COLORS['border']),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('ALIGN', (1, 1), (-1, -1), 'CENTER'),
        ]))
        return table

    def build_mitre_section() -> List[Any]:
        coverage_data = report_data.get('mitre_coverage', {})
        if not coverage_data:
            return []

        rows = [['Tactic', 'Validated', 'Claimed', 'Coverage']]
        total_techniques = 0
        total_validated = 0
        for tactic, data in sorted(coverage_data.items()):
            total = data.get('total', 0)
            validated = data.get('validated', 0)
            claimed = data.get('claimed', 0)
            coverage_pct = int((validated / total) * 100) if total else 0
            rows.append([tactic, str(validated), str(claimed), f"{coverage_pct}%"])
            total_techniques += total
            total_validated += validated

        table = Table(rows, colWidths=[2.5*inch, 1.1*inch, 1.1*inch, 1.1*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['secondary']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.4, COLORS['border']),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('ALIGN', (1, 1), (-1, -1), 'CENTER'),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
        ]))
        return [table]

    def build_detection_table() -> Table:
        detections = report_data.get('detections', [])
        rows = [['Detection', 'Technique', 'Status', 'Last Tested']]
        status_commands = []

        for idx, det in enumerate(detections[:12], start=1):
            state = derive_health_state(det)
            label, hex_color = STATUS_PALETTE.get(state, ("Unknown", "#4B5563"))
            if label in ("Untested", "Pending Validation"):
                label = "Pending"
            last_test = det.get('last_tested_at', '—')
            if isinstance(last_test, str) and last_test not in ('', 'Never'):
                try:
                    dt = datetime.fromisoformat(last_test.replace('Z', '+00:00'))
                    last_test = dt.strftime('%Y-%m-%d')
                except Exception:
                    pass
            rows.append([
                Paragraph(det.get('title', 'N/A')[:48], body_style),
                Paragraph(det.get('technique_id', 'N/A') or 'N/A', body_style),
                Paragraph(label, body_style),
                Paragraph(last_test or '—', body_style),
            ])
            status_commands.append(('TEXTCOLOR', (2, idx), (2, idx), colors.HexColor(hex_color)))

        table = Table(rows, colWidths=[3.2*inch, 0.9*inch, 1.1*inch, 1.3*inch])
        style_cmds = [
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['secondary']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.25, COLORS['border']),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
        ]
        style_cmds.extend(status_commands)
        table.setStyle(TableStyle(style_cmds))
        return table

    def build_test_activity_table() -> Table:
        tests = sorted(report_data.get('tests', []), key=lambda x: x.get('started_at', ''), reverse=True)[:5]
        rows = [['Technique', 'Result', 'Environment', 'Executed']]
        result_commands = []
        for idx, test in enumerate(tests, start=1):
            started = test.get('started_at', 'N/A')
            if isinstance(started, str) and started not in ('', 'N/A'):
                try:
                    dt = datetime.fromisoformat(started.replace('Z', '+00:00'))
                    started = dt.strftime('%Y-%m-%d %H:%M')
                except Exception:
                    pass
            result = (test.get('result') or 'N/A').upper()
            result_display = result.title() if result not in ('', 'N/A') else 'N/A'
            result_color = colors.HexColor(RESULT_PALETTE.get(result, "#1F2937"))
            rows.append([
                Paragraph(test.get('technique_id', 'N/A'), body_style),
                Paragraph(result_display, body_style),
                Paragraph(test.get('environment', 'N/A'), body_style),
                Paragraph(started or 'N/A', body_style),
            ])
            result_commands.append(('TEXTCOLOR', (1, idx), (1, idx), result_color))
        table = Table(rows, colWidths=[1.4*inch, 1.0*inch, 1.2*inch, 2.0*inch])
        style_cmds = [
            ('BACKGROUND', (0, 0), (-1, 0), COLORS['info']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.25, COLORS['border']),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('ALIGN', (0, 1), (-1, -1), 'CENTER'),
        ]
        style_cmds.extend(result_commands)
        table.setStyle(TableStyle(style_cmds))
        return table

    def build_recommendations_cards() -> List[Any]:
        recs = report_data.get('recommendations') or []
        chips: List[Any] = []

        if not recs:
            recs = [
                {"title": "Run Validation"},
                {"title": "Improve Coverage"},
            ]

        row = []
        for rec in recs[:6]:
            title = rec.get('title') or 'Next Action'
            chip = Table(
                [[Paragraph(f"<font size=8>{title.upper()}</font>", body_style)]],
                colWidths=[1.8*inch]
            )
            chip.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), colors.white),
                ('BOX', (0, 0), (-1, -1), 0.4, COLORS['border']),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (-1, -1), 4),
                ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ]))
            row.append(chip)
        if not row:
            return []
        chips.append(Table([row], colWidths=[2.0*inch]*len(row)))
        return chips

    metadata_line = " · ".join([
        f"Org: {organization_name}",
        f"Envs: {environments_text}",
        f"Report Period: {report_period_text}",
        f"Generated: {generated_at_text}",
        f"Report ID: {report_id_text}",
    ])

    def add_footer(canvas_obj, doc_obj):
        canvas_obj.saveState()
        canvas_obj.setFont("Helvetica", 7)
        canvas_obj.setFillColor(COLORS["dark"])
        canvas_obj.drawString(doc.leftMargin, 0.5 * inch, metadata_line)
        page_text = f"Page {canvas_obj.getPageNumber()}"
        canvas_obj.drawRightString(doc.pagesize[0] - doc.rightMargin, 0.5 * inch, page_text)
        canvas_obj.restoreState()

    # Build the one-page layout
    story.append(build_header_block())
    story.append(Spacer(1, 0.12*inch))

    story.append(build_summary_cards())
    story.append(build_divider())
    story.append(Spacer(1, 0.06*inch))

    story.append(Paragraph("Detection Status", section_heading_style))
    story.append(build_health_breakdown_table())
    story.append(build_divider())
    story.append(Spacer(1, 0.06*inch))

    story.append(Paragraph("ATT&CK Coverage", section_heading_style))
    mitre_flowables = build_mitre_section()
    if mitre_flowables:
        for flow in mitre_flowables:
            story.append(flow)
    else:
        story.append(Paragraph("—", body_style))
    story.append(build_divider())
    story.append(Spacer(1, 0.06*inch))

    story.append(Paragraph("Detections", section_heading_style))
    if report_data.get('detections'):
        story.append(build_detection_table())
    else:
        story.append(Paragraph("—", body_style))
    story.append(build_divider())
    story.append(Spacer(1, 0.06*inch))

    story.append(Paragraph("Test Activity", section_heading_style))
    if report_data.get('tests'):
        story.append(build_test_activity_table())
    else:
        story.append(Paragraph("No Runs", body_style))
    story.append(build_divider())
    story.append(Spacer(1, 0.06*inch))

    story.append(Paragraph("Next Actions", section_heading_style))
    rec_cards = build_recommendations_cards()
    if rec_cards:
        for card in rec_cards:
            story.append(card)
    else:
        story.append(Paragraph("—", body_style))

    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    return output_path
