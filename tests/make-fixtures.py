#!/usr/bin/env python3
"""
Synthetic workbooks for the failure-path tests.

Deliberately not the real training plan: these are throwaway files with known
shapes, so a test that fails points at the app rather than at somebody's data.

    python3 tests/make-fixtures.py            # writes into tests/fixtures/

Needs openpyxl (pip install openpyxl). The tests themselves need Playwright and
a static server on port 7810:

    python3 -m http.server 7810
    node tests/failure-paths.js
"""
import datetime
import os

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures')

HEADERS = ['Week', 'Date', 'Day', 'Sport', 'Workout', 'Duration (min)',
           'Intensity', 'Purpose', 'Done', 'Actual (min)', 'Actual (km)',
           'Avg HR', 'Effort']

DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


def monday_of_this_week():
    today = datetime.date.today()
    return today - datetime.timedelta(days=today.weekday())


def plain(path):
    """An ordinary week: something on most days, one rest day, one blank day."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Weekly Schedules'
    ws.append(HEADERS)

    monday = monday_of_this_week()
    week = [
        (2, 'Swim', 'Easy technique: 4x50 drill, then 6x50 smooth', 30, 'Z1-Z2', 'Feel for the water'),
        (2, 'Mobility', 'Hips and T-spine', 15, '-', 'Keep the hips honest'),
        (3, 'Run', 'Easy run, conversational the whole way', 30, 'Z2', 'Aerobic base'),
        (4, 'Rest', 'REST DAY - full day off', None, '-', 'Adaptation happens at rest'),
        (5, 'Bike', 'Steady aerobic ride, flat to rolling', 60, 'Z2', 'Time in the saddle'),
        (6, 'Run', 'Easy run + strides', 35, 'Z2', 'Turnover'),
        (6, 'Strength', 'Squat, hinge, press, row', 30, 'RPE 7', 'Durability'),
    ]
    for offset, sport, workout, minutes, zone, purpose in week:
        date = monday + datetime.timedelta(days=offset)
        ws.append([1, date.isoformat(), DAYS[date.weekday()], sport,
                   workout, minutes, zone, purpose])

    last = ws.max_row + 1
    ws.cell(last, 5, 'Weekly total')
    ws.cell(last, 6, '=SUM(F2:F%d)' % (last - 1))
    wb.save(path)


def hostile_text(path):
    """Every cell that reaches the screen, carrying something that should not."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Weekly Schedules'
    ws.append(HEADERS)

    monday = monday_of_this_week()
    rows = [
        ('Swim', '<img src=x onerror="window.hacked=1">', 30, 'injection attempt'),
        ('Run', '</p><script>window.hacked=2</script>', 40, '"quotes" & <ampersands>'),
        ('Bike', "onclick=alert(1) '\" ><", 45, 'attribute break-out'),
        ('Strength', 'A' * 4000, 35, 'a title with no end to it'),
    ]
    for index, (sport, workout, minutes, purpose) in enumerate(rows):
        date = monday + datetime.timedelta(days=index)
        ws.append([1, date.isoformat(), DAYS[date.weekday()], sport,
                   workout, minutes, 'Z2', purpose])
    wb.save(path)


def column_inserted(path):
    """The same plan with one column pushed in on the left.

    Every heading to its right moves one column over, which is exactly what a
    saved layout cannot see for itself."""
    wb = openpyxl.load_workbook(os.path.join(OUT, 'plain.xlsx'))
    ws = wb['Weekly Schedules']
    ws.insert_cols(2)
    ws.cell(1, 2, 'Notes to self')
    ws.cell(2, 2, 'inserted in Excel')
    wb.save(path)


def foreign_extras(path):
    """Somebody else's sheet already sitting on the name the app wants."""
    wb = openpyxl.load_workbook(os.path.join(OUT, 'plain.xlsx'))
    ws = wb.create_sheet('Extras')
    ws.append(['Race entry', 'Cost', 'Paid?'])
    ws.append(['Kalmar 2027', 4200, 'Yes'])
    ws.append(['Jonkoping 70.3', 1900, 'No'])
    wb.save(path)


def broken(path_rubbish, path_truncated, source):
    with open(path_rubbish, 'wb') as fh:
        fh.write(b'this is not a zip, it is a sentence')
    with open(source, 'rb') as fh:
        good = fh.read()
    with open(path_truncated, 'wb') as fh:
        fh.write(good[:int(len(good) * 0.6)])


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    plain(os.path.join(OUT, 'plain.xlsx'))
    hostile_text(os.path.join(OUT, 'nasty.xlsx'))
    column_inserted(os.path.join(OUT, 'column-inserted.xlsx'))
    foreign_extras(os.path.join(OUT, 'foreign-extras.xlsx'))
    broken(os.path.join(OUT, 'rubbish.xlsx'),
           os.path.join(OUT, 'truncated.xlsx'),
           os.path.join(OUT, 'plain.xlsx'))
    print('fixtures written to', OUT)
