// Starting values for Library → Quotations. Admin can change all of this in the app;
// this is only used until the first save.
const topics = [
  { id: 'payment', title: 'Payment', short: 'A deposit of RM {deposit} per pax is needed to confirm. Balance due {days} days before departure.', full: 'A booking is confirmed when the deposit is received (RM {deposit} per pax). The balance is due {days} days before departure. Late payment may lead to the booking being released without notice.' },
  { id: 'validity', title: 'Prices & validity', short: 'Prices valid until {valid}; subject to availability.', full: 'Prices are in Malaysian Ringgit and valid until {valid}. They depend on availability and on supplier, airline and exchange-rate changes until paid in full. Flight fares are guaranteed only once ticketed.' },
  { id: 'cancel', title: 'Cancellation & refund', short: 'Per airline/supplier terms; assessed case by case.', full: 'Cancellations must be made in writing. Charges depend on the airline and supplier terms at the time. Non-refundable portions (e.g. air tickets already issued) cannot be recovered. Any refund is assessed case by case.' },
  { id: 'flights', title: 'Flights & airline changes', short: 'Schedules and baggage rules are set by the airline and may change.', full: 'Flight times, routes, aircraft and baggage allowance are set by the airline and may change. We will inform you as soon as we are told, but are not liable for airline-caused delay, rescheduling or cancellation. Name and date changes follow the airline’s rules and fees.' },
  { id: 'weather', title: 'Weather & force majeure', short: 'Itinerary may be adjusted for safety or weather.', full: 'Activities may be changed, shortened or cancelled for safety or weather. We are not liable for events beyond our control (natural disaster, strike, epidemic, government action, etc.). We will try to offer a suitable alternative.' },
  { id: 'itinerary', title: 'Itinerary & supplier changes', short: 'Hotels, transport or activities may be replaced with similar standard.', full: 'We may replace hotels, transport or activities with a similar standard if necessary.' },
  { id: 'documents', title: 'Travel documents & visa', short: 'Passport (6 months validity) and visa are the traveller’s responsibility.', full: 'Passport must be valid at least 6 months after the return date. Visas, entry rules and health requirements are the traveller’s responsibility.' },
  { id: 'insurance', title: 'Travel insurance', short: 'Travel insurance is strongly recommended.', full: 'Travellers are strongly advised to buy travel insurance. We are not responsible for loss, injury or illness during the trip.' },
  { id: 'conduct', title: 'Conduct & health', short: 'Travellers must follow guide and local instructions.', full: 'Travellers must follow guide and local instructions. We may refuse service to anyone whose conduct endangers others, without refund.' },
  { id: 'media', title: 'Media coverage', short: 'Photos/videos may be used for promotion; tell us in writing if you object.', full: 'Photos and videos taken during the trip may be used in our promotion. Tell us in writing before departure if you do not agree.' },
  { id: 'pdpa', title: 'Personal data (PDPA)', short: 'Data is used only for this booking and service updates.', full: 'Your personal data is collected for this booking and related service updates, and shared only with airlines, hotels and suppliers needed to deliver the trip, in line with the Personal Data Protection Act 2010.' },
];
const all = topics.map(t => t.id);
const defaults = {
  company: { name: 'EXCAPISM MY VENTURES', address: 'NO. 13 JALAN SG 6/2\nTAMAN SERI GOMBAK\n68100, BATU CAVES\nMALAYSIA', email: 'excapism.my@gmail.com', phone: '+601153265523', bank: 'MAYBANK', accountNo: '564324778322', accountName: 'EXCAPISM MY VENTURES', logo: '' },
  defaults: { prefix: 'QT-', validDays: 14, depositPerPax: 100, balanceDays: 30, footer: 'This is a computer-generated quotation. No signature is required.',
    estimateNote: 'Prices of these items can change (for example airline fares) and were checked on {date}. They are confirmed at booking — airline fares only once ticketed — and we send a revised quotation before charging for any of these.' },
  terms: {
    topics,
    templates: [
      { id: 'standard', name: 'Standard', on: all.filter(i => !['itinerary', 'conduct'].includes(i)) },
      { id: 'overseas', name: 'Overseas flight trip', on: all },
      { id: 'ground', name: 'Ground only', on: all.filter(i => i !== 'flights') },
      { id: 'corporate', name: 'Corporate', on: all.filter(i => !['media', 'conduct'].includes(i)) },
    ],
  },
  items: [
    { code: 'GRD-0001', description: 'Ground package', price: null, per: 'pax' },
    { code: 'ALL-0001', description: 'All-in package', price: null, per: 'pax' },
    { code: 'GEN-0001', description: 'Flight ticket', price: null, per: 'pax', kind: 'est', note: 'Fare checked on the quotation date · taxes included' },
    { code: 'ADD-0001', description: 'Add-on: luggage 20kg (return)', price: null, per: 'qty', kind: 'est', note: 'Airline price on the quotation date' },
    { code: 'ADD-0009', description: 'Add-on: seat selection (return)', price: null, per: 'qty', kind: 'est', note: 'Standard seats · airline price on the quotation date' },
    { code: 'ADD-0002', description: 'Add-on: room request / single supplement', price: null, per: 'qty' },
    { code: 'ADD-0003', description: 'Travel insurance', price: null, per: 'pax' },
    { code: 'ADD-0004', description: 'Visa assistance', price: null, per: 'pax' },
    { code: 'ADD-0005', description: 'Airport transfer', price: null, per: 'qty' },
    { code: 'ADD-0006', description: 'SIM / eSIM', price: null, per: 'pax' },
    { code: 'ADD-0007', description: 'Tour guide', price: null, per: 'qty' },
    { code: 'ADD-0008', description: 'Entrance tickets / activities', price: null, per: 'pax' },
    { code: 'DISC', description: 'Discount', price: null, per: 'qty' },
  ],
  presets: [],
  waTemplate: [
    '*QUOTATION {number}*',
    'For: {customer}',
    'Trip: {trip}',
    '',
    '{items}',
    '',
    '*Total: RM {total}*',
    '{estimate_note}',
    '{deposit_line}',
    '{valid_line}',
  ].join('\n'),
};
module.exports = { defaults };
