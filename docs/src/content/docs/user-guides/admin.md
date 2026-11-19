---
title: Managing users
description: The app's admin section, for R9lab administrators who manage accounts.
---

Administrators (superusers) manage accounts from the app. Everyone else does not see this
section, and the API refuses its routes to them whatever the app shows.

## Before you start

The admin tools need two-step verification on your own account. Without it, the section shows
"Turn on two-step verification first" and links to **Account → Security & sessions**, where you
set it up. Come back once it is on.

## Find a user

Open **Account → Admin → Users**. The list shows 25 accounts a page, sorted by email address.

- Search matches part of an email address or username.
- The filter buttons show only suspended, unverified or superuser accounts.
- Badges mark each account's state: suspended, superuser, role, unverified, and whether
  two-step verification is on.

Select an account to open it.

## What you can change

Every change asks you to confirm first and is written to the audit log with your account id.

| Action                      | What it does                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Make lab / contributor      | Sets the contributor tier. `lab` adds research-file uploads and the larger quota. Superusers always hold `lab`.                                                      |
| Reset two-step verification | Turns it off, for someone who lost both their authenticator and their recovery codes. Confirm who is asking first: the account can then sign in with only a password. |
| Suspend account             | Signs the account out everywhere and blocks sign-in. Its products and data stay. You cannot suspend your own account or the last active superuser.                   |
| Reactivate account          | Lets a suspended account sign in again.                                                                                                                              |
| Delete account              | Erases the account and its personal data. Choose to keep its products (they move to an anonymous account) or delete them too, then type the email address to confirm. You cannot undo it. |

Your own account shows none of these. Change your two-step verification or delete your account
from **Account** instead, which asks for your password first.

There is no button to mark an email address verified. Verification proves that the person controls
the mailbox, and social sign-in links to an account by email only once it is verified. Ask the
person to resend the verification email from their account screen instead.

Superuser status cannot be set from the app or the API.

For the routes behind these actions, see [Using the API](../api/).
