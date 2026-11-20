// Prices in whole rupees, as India writes them: ₹1,299 and ₹1,00,000.
// Every price the shop shows includes GST.
const digits = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const rupees = (amount: number): string => `₹${digits.format(amount)}`;
