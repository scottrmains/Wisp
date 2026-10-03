targetScope = 'subscription'

// Cost alerts only, not a spending cap. Covers tagged managed networking too.
@allowed(['dev', 'staging', 'prod'])
param environment string
@minValue(1)
param monthlyBudget int
@minLength(1)
param budgetEmails array
param budgetStart string
param budgetEnd string

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'wisp-accounts-${environment}-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudget
    timeGrain: 'Monthly'
    timePeriod: { startDate: '${budgetStart}T00:00:00Z', endDate: '${budgetEnd}T00:00:00Z' }
    filter: {
      and: [
        { tags: { name: 'application', operator: 'In', values: ['WISP'] } }
        { tags: { name: 'environment', operator: 'In', values: [environment] } }
        { tags: { name: 'purpose', operator: 'In', values: ['accounts'] } }
      ]
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: budgetEmails
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: budgetEmails
      }
    }
  }
}
