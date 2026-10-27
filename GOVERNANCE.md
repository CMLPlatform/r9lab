# Governance

R9lab is a research software project at the Institute of Environmental Sciences (CML), Leiden
University. This page says who decides what, who can change the repository, and who takes over if
the maintainer cannot continue.

## People

- **Maintainer:** Simon van Lierde ([@simonvanlierde](https://github.com/simonvanlierde)) reviews
  and merges pull requests, triages issues, cuts releases, approves deploys to staging and
  production, and handles security reports as [SECURITY.md](.github/SECURITY.md) describes.
- **Supervisor:** Franco Donati ([@FDonati](https://github.com/FDonati)) sets the research
  direction with the maintainer and takes over if the maintainer cannot continue.
- **Contributors:** anyone who opens an issue or a pull request. Marin Visscher
  ([@mrvisscher](https://github.com/mrvisscher)) has contributed code.

A new maintainer is named here first.

## Decisions

The maintainer makes the final call on features, design, releases, and what goes on the
[roadmap](https://docs.r9lab.io/project/roadmap/), and agrees the research direction with the
supervisor.

Anyone can propose a change by opening an issue or a pull request. Proposals are discussed in the
open on that issue or pull request. Contributions follow [CONTRIBUTING.md](.github/CONTRIBUTING.md)
and the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Access

- Eight GitHub accounts have admin access to the repository: @simonvanlierde, @FDonati, @bfdb,
  @TomerFishman, @robyistrate, @mrvisscher, @SoniaMCunha, and @Oskar-Imiolek. Nobody has write
  access without admin. The CMLPlatform organisation gives members no access to a repository until
  an admin grants it.
- Changes to `main` go through pull requests that need one approving review and the `CI Result`
  check on an up-to-date branch. Admins and the Renovate app may merge without the review; only
  admins may merge without the check. Force-pushes and deletion of `main` are blocked.
- Images reach GHCR only through `publish-images.yml`: `release.yml` calls it when a GitHub release
  is published, and an admin can run it by hand to publish one commit as `:sha-<short sha>`. The
  release's `staging` and `prod` deploy jobs wait for an approving review from the maintainer. Only admins and
  maintainers may create, move, or delete release tags.
- Renovate opens the dependency pull requests.

## If the Maintainer Is Unavailable

Franco Donati takes over. He already has admin access to the repository, and images publish from
GitHub Actions, so he can triage, merge, and release without any key of the maintainer's.

The running platform also depends on accounts outside GitHub: the Cloudflare account that serves
r9lab.io and its subdomains, the deploy hosts, and the Zenodo record. The maintainer keeps the
recovery details for each where Franco can reach them.

If nobody can continue, the README says so and the repository is archived; anyone may fork it under
its licences.

## Changes to This Document

The maintainer changes this page through a normal pull request. If the project gains more
maintainers, the page will say how they are added and how decisions are made among them.
