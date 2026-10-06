/** Quote refreshes are wasted work while nobody sees the ticket or an order is already in flight. */
export function shouldRefreshQuote(state: { hidden: boolean; orderPending: boolean }): boolean {
  return !state.hidden && !state.orderPending
}
