"""
End-to-End Production Verification Test Suite
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fastapi.testclient import TestClient
import main

client = TestClient(main.app)

# 1. Test Static Index
r_index = client.get('/')
assert r_index.status_code == 200, f'Index failed: {r_index.status_code}'
assert '<!doctype html>' in r_index.text.lower(), 'Index does not contain HTML'
print('1. Static SPA Index Serving: PASSED')

# 2. Test Spots API
r_spots = client.get('/api/spots?lat=28.6315&lng=77.2195&vehicle_type=Sedan')
assert r_spots.status_code == 200, f'Spots failed: {r_spots.status_code}'
data = r_spots.json()
print(f'2. Spots API: {len(data["spots"])} spots returned (top: {data["spots"][0]["name"]})')

# 3. Test God's Eye Zones & Overlay
r_zones = client.get('/api/gods-eye/zones')
assert r_zones.status_code == 200, f'Zones failed: {r_zones.status_code}'
zone_id = r_zones.json()['zones'][0]['zone_id']
r_overlay = client.get(f'/api/gods-eye/overlay/{zone_id}')
assert r_overlay.status_code == 200, f'Overlay failed: {r_overlay.status_code}'
assert r_overlay.headers['content-type'] == 'image/jpeg', 'Overlay not JPEG'
print(f'3. Gods Eye Overlay for {zone_id}: {len(r_overlay.content)} bytes JPEG generated')

# 4. Test OpenCV Live Camera / Synthetic CCTV Analyzer
r_cv = client.post('/api/gods-eye/analyze-frame', json={'use_demo_cctv': True})
assert r_cv.status_code == 200, f'CV failed: {r_cv.status_code}'
cv_res = r_cv.json()
print(f'4. OpenCV Analysis: Gap = {cv_res["gap_meters"]}m, Slots = {cv_res["slots_detected"]}, Compatible = {cv_res["compatible_vehicles"]}')

# 5. Test 15-Minute Guaranteed Booking & Ledger
first_mall = next(s for s in data['spots'] if s['spot_type'] == 'mall')
r_book = client.post('/api/book', json={
    'spot_id': first_mall['id'],
    'spot_name': first_mall['name'],
    'price_per_hour': first_mall['price_per_hour'],
    'vehicle_number': 'DL 01 AB 9999',
    'hours': 2,
    'vehicle_type': 'SUV'
})
assert r_book.status_code == 200, f'Booking failed: {r_book.status_code}'
book_res = r_book.json()
print(f'5. Booking Created: ID = #{book_res["booking_code"]}, Bay = {book_res["floor_bay_assigned"]}, Gross = Rs.{book_res["gross_amount"]}, 10% Mall = Rs.{book_res["mall_share_10pct"]}, Remaining = {book_res["hold_seconds_remaining"]}s')

# 6. Test Partner Ledger
r_ledger = client.get('/api/partner/ledger')
assert r_ledger.status_code == 200, f'Ledger failed: {r_ledger.status_code}'
ledger_data = r_ledger.json()
print(f'6. Partner Ledger: Gross = Rs.{ledger_data["gross_revenue"]}, Mall 10% = Rs.{ledger_data["mall_10pct_share"]}, Total Bookings = {ledger_data["total_bookings"]}')

# 7. Test Checkout
r_checkout = client.post(f'/api/bookings/{book_res["booking_id"]}/checkout')
assert r_checkout.status_code == 200, f'Checkout failed: {r_checkout.status_code}'
print(f'7. Checkout Release: {r_checkout.json()["status"]}')

# 8. Test Health
r_health = client.get('/api/health')
assert r_health.status_code == 200, f'Health failed: {r_health.status_code}'
print(f'8. System Health: {r_health.json()["status"]}, Spots count = {r_health.json()["live_parking_spots"]}')

# 9. Test Double Slash URL Normalization (regression test for Render & Netlify trailing slash)
r_slash_spots = client.get('http://testserver//api/spots?lat=28.6315&lng=77.2195&vehicle_type=Sedan')
assert r_slash_spots.status_code == 200, f'Double slash normalization failed on spots: {r_slash_spots.status_code}'
assert len(r_slash_spots.json()['spots']) > 0, 'No spots returned via double slash URL'

r_slash_health = client.get('http://testserver//api/health')
assert r_slash_health.status_code == 200, f'Double slash normalization failed on health: {r_slash_health.status_code}'
print('9. Double Slash URL Normalization (//api/spots, //api/health): PASSED')

print('\n>>> ALL PRODUCTION INTEGRATION TESTS PASSED WITH 100% SUCCESS! <<<')
