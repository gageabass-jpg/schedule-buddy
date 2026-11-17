---
name: wagonwheel-week
description: Show what is overdue, due this week and in progress in Wagonwheel, and suggest an order to tackle it. Changes nothing.
---

# What is on my plate

1. Call `get_overview` from the `wagonwheel` server. Use the date it returns as today.
2. Show, in this order, each as a short list with the project name beside every task:
   - **Overdue** (oldest first)
   - **Due in the next 7 days** (soonest first)
   - **In progress**
   - **Milestones within 30 days**
3. Suggest an order to work through them: overdue and high-priority first, then what is due soonest. Give one line of reasoning for anything you move out of date order.
4. If the current repository matches a project's connected repository, put that project's tasks first and say so.
5. Do not change anything. Offer to create, update or complete tasks if something looks stale.
