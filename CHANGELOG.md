# Changelog

## [1.2.0](https://github.com/baraka-mshindi/google/compare/google-v1.1.0...google-v1.2.0) (2026-11-16)


### Features

* **calendar:** add availability, slot suggestions and event status ([1c7bc2e](https://github.com/baraka-mshindi/google/commit/1c7bc2e0100def7451994b3c364d339a1039a5e3))
* **calendar:** add Calendar API transport and retry policy ([c7424e6](https://github.com/baraka-mshindi/google/commit/c7424e665b9aabdc214175def051531b1045d5ba))
* **calendar:** add Calendar service for interview scheduling ([b3018ad](https://github.com/baraka-mshindi/google/commit/b3018ad9e678eeed50d02976c40b5b86bccb0e00))
* **calendar:** add slot finder with DST-safe time zone maths ([8070ae2](https://github.com/baraka-mshindi/google/commit/8070ae23c4ca983cea65e79952861369b082980d))
* **calendar:** create events without duplicate invites ([f196748](https://github.com/baraka-mshindi/google/commit/f196748e008d167ed990934a79289a29944be8d8))
* **calendar:** publish the /calendar subpath ([013178b](https://github.com/baraka-mshindi/google/commit/013178b819d0886066140f07f44bdf79574f4b02))
* **calendar:** reschedule and cancel managed events ([017f817](https://github.com/baraka-mshindi/google/commit/017f8174d40b3304021a28da55c34134814a97c0))
* **calendar:** validate event input and derive idempotent event ids ([00ef8b6](https://github.com/baraka-mshindi/google/commit/00ef8b682e473ba605c113255cb87d7402ee7531))
* **core:** add calendar scopes, errors and audit events ([0f5d866](https://github.com/baraka-mshindi/google/commit/0f5d8661c05934de13e75c75c88b958e141c2fbf))


### Bug Fixes

* **calendar:** apply reschedules after manual edits and repair Meet links ([d50a37b](https://github.com/baraka-mshindi/google/commit/d50a37b27aa50a6fd25dc5877c4d6e7f207aa91a))
* **calendar:** cancel never-invited pending events without notifying guests ([f6933d8](https://github.com/baraka-mshindi/google/commit/f6933d87f639e62c66cda6d803b54b3695637771))
* **calendar:** emit created when a 401 re-run finds our landed release ([da9953c](https://github.com/baraka-mshindi/google/commit/da9953ca093ddd10774f2d3fa66b90663a5080df))
* **calendar:** guard invite release with etag preconditions ([98666c6](https://github.com/baraka-mshindi/google/commit/98666c603e45468d2078cdf70c09f6c8b819076a))
* **calendar:** resolve repeated wall times in 30-minute DST zones ([87dc249](https://github.com/baraka-mshindi/google/commit/87dc249a46220d57c9c7cbc610e521ff61f88e33))
* **calendar:** support Node 18 with the Calendar API peer range ([5845f5c](https://github.com/baraka-mshindi/google/commit/5845f5c7ac0ff5bdff89cb50de69ee800d57b3a8))
* **calendar:** validate slot params before any Google call and sanitize reads ([4a523c7](https://github.com/baraka-mshindi/google/commit/4a523c76e03696f494e87d52fe1f270ccd0ed131))


### Documentation

* **calendar:** add scheduling guide and update spec ([c55653f](https://github.com/baraka-mshindi/google/commit/c55653fbb54d910a753cfc81a901a96012bcdf85))
* **calendar:** cover Node 18/20 install, testing and edge cases in the guide ([a14da0a](https://github.com/baraka-mshindi/google/commit/a14da0a6ad00830f7637583bfccacccc24ab5d64))

## [1.1.0](https://github.com/mshindi-labs/google/compare/google-v1.0.2...google-v1.1.0) (2026-11-05)


### Features

* **postgres:** add Prisma and TypeORM query wrappers ([d4ce6df](https://github.com/mshindi-labs/google/commit/d4ce6dfa46033de3990fe4d6fbfb3828ed820586))
* **postgres:** add Prisma and TypeORM query wrappers ([d6cbcad](https://github.com/mshindi-labs/google/commit/d6cbcad471cd081cb789857a2f01a68e0f135dfb))


### Bug Fixes

* **postgres:** scrub TypeORM error parameters and harden runner release ([079dd00](https://github.com/mshindi-labs/google/commit/079dd004f30b242bcaef6b3bb6a9d306b6e40edb))


### Documentation

* add Prisma and TypeORM integration guide ([a10180c](https://github.com/mshindi-labs/google/commit/a10180c2a6510799ecf0382d37d9657cb818a85f))
* **postgres:** fix ORM guide migrations, RLS and logging advice ([98ebb90](https://github.com/mshindi-labs/google/commit/98ebb90cc68fba40c338c6bcf63742fe7be80312))

## [1.0.2](https://github.com/mshindi-labs/google/compare/google-v1.0.1...google-v1.0.2) (2026-11-05)


### Bug Fixes

* **release:** run package export tests before publishing ([db83078](https://github.com/mshindi-labs/google/commit/db830789d018851ddbcf3641750b2ef49815cf88))
* **release:** run package export tests before publishing ([33f9ae6](https://github.com/mshindi-labs/google/commit/33f9ae6fee5e1259ae14b815908a4d17b43555aa))

## [1.0.1](https://github.com/mshindi-labs/google/compare/google-v1.0.0...google-v1.0.1) (2026-11-05)


### Bug Fixes

* **build:** add repository metadata for npm provenance ([4bfdbc1](https://github.com/mshindi-labs/google/commit/4bfdbc174820f2e8e2a460b0d0db337517997336))
* **build:** add repository metadata for npm provenance ([395ed7a](https://github.com/mshindi-labs/google/commit/395ed7a4e16d0ffdf7147077d68d006dd63784cb))

## 1.0.0 (2026-11-05)


### Features

* add @mshindi-labs/google v1 (multi-tenant Gmail sending) ([3b8ca31](https://github.com/mshindi-labs/google/commit/3b8ca319b3591e5bed9d6918479e76accb6338b8))
* **core:** add access token cache and connections API ([571b63c](https://github.com/mshindi-labs/google/commit/571b63c5b55027aa492e9802f29864831e16dab5))
* **core:** add createGoogle, events, scopes and tenant client config ([722baea](https://github.com/mshindi-labs/google/commit/722baeacc5717f03f9d5a217f82db065bc929fba))
* **core:** add credential store interface and in-memory store ([84f2483](https://github.com/mshindi-labs/google/commit/84f2483af17e0e6e5934875fca6b53055e00c6a1))
* **core:** add envelope encryption and static key providers ([a021738](https://github.com/mshindi-labs/google/commit/a0217387fd4f822a3c9f17e46d96ae5ff0c6b0d9))
* **core:** add GCP and AWS KMS key providers ([a4a1df2](https://github.com/mshindi-labs/google/commit/a4a1df280d6dd3580ee48b1373b5c0f263032c13))
* **core:** add key rewrap and credential verification tools ([fb8b0fc](https://github.com/mshindi-labs/google/commit/fb8b0fcc8e42567331349af117e3bbe9ce580c99))
* **core:** add OAuth gateway with google-auth-library and test fake ([30d757a](https://github.com/mshindi-labs/google/commit/30d757a4022c458e7102f25f6da53e7142b7a2a2))
* **core:** generate OAuth consent URLs with server-side state and PKCE ([9b075bd](https://github.com/mshindi-labs/google/commit/9b075bd83f7755680efa6a1191b53cd2833685c4))
* **core:** handle OAuth callback with ID token and account checks ([9bdbe14](https://github.com/mshindi-labs/google/commit/9bdbe14aa90ee5eb30e27fce26b00db153fa445d))
* **gmail:** build MIME with MailComposer and enforce size limits ([df9db30](https://github.com/mshindi-labs/google/commit/df9db300b799dd1ee7289321aef3da3b454ae7c0))
* **gmail:** send through Gmail API with safe retries and capture transport ([7479c84](https://github.com/mshindi-labs/google/commit/7479c8458e54f5ce92a4a0289cd2f9829ea002fc))
* **gmail:** validate send input against header injection ([581e3ee](https://github.com/mshindi-labs/google/commit/581e3ee221342f92e9edbdd673adc2b0b5a59d3c))
* **postgres:** add Postgres credential store and migration ([974183a](https://github.com/mshindi-labs/google/commit/974183a42cdad84e9bb1c577d89da6458799c186))


### Bug Fixes

* **core:** check status on cached tokens and make touch best-effort ([5e61649](https://github.com/mshindi-labs/google/commit/5e616496f5bb5ddb2205370d60be417e590d0e60))
* **core:** fail closed on malformed envelopes and zero unwrapped keys ([378a7e8](https://github.com/mshindi-labs/google/commit/378a7e8a5a01f8bc1df39ffd4b5c0921f4509524))
* **core:** load AWS SDK only when needed and surface missing KMS peers ([58e94c9](https://github.com/mshindi-labs/google/commit/58e94c9c022cd9d2ed241cdd7efe2c67b222d88c))
* **core:** revoke issued token on any post-exchange failure ([0758f1c](https://github.com/mshindi-labs/google/commit/0758f1c93aa2023d3e8885944ebe67643ce2283b))
* **core:** share internals across ESM and CJS, rename ErrorOptions ([5716a09](https://github.com/mshindi-labs/google/commit/5716a09afea7a76a621c4886012616c299b69021))
* **core:** use targeted store updates so revocation is never undone ([fd589e3](https://github.com/mshindi-labs/google/commit/fd589e322771decb19d17fe528253cdddeb1d853))
* **gmail:** block extensions behind trailing dots, escape header names ([93c4bdb](https://github.com/mshindi-labs/google/commit/93c4bdb72f9ec1a837f90b1e03e221b66caf3c5b))
* **gmail:** reject invalid message ids and close unread attachment streams ([27340f2](https://github.com/mshindi-labs/google/commit/27340f2290222dc35302ab585324c792f050d067))
* **gmail:** treat ambiguous send outcomes as unknown and cap retry-after ([55fd5f2](https://github.com/mshindi-labs/google/commit/55fd5f23f2b06aa4f4129e24708dad6446782097))
* **gmail:** use the sanitized fromName in the From header ([7e86d6f](https://github.com/mshindi-labs/google/commit/7e86d6f1a1dfb34012ec11c3f9735af0e1c89ce3))
* **postgres:** cas encrypted replace, tolerate bad ids, correct rls guide ([54c5dbc](https://github.com/mshindi-labs/google/commit/54c5dbcf0b7de875f6c4451a6e1341e6d35c18b9))
* **testing:** enforce required auth URL params in fake and harden leak test ([515f04a](https://github.com/mshindi-labs/google/commit/515f04a4caddeefb1f6daa61fdc18ebd83d97fa5))


### Documentation

* add design spec and v1 implementation plan ([1849288](https://github.com/mshindi-labs/google/commit/1849288922491aed6ce67d9a303f271d0218a580))
* add README and tenant, host and bulk-sending guides ([64fe72a](https://github.com/mshindi-labs/google/commit/64fe72ae7418049ff1853c713a9a8c9fa1a4cc23))
* **bulk-sending:** claim before send and branch on error kind ([b285686](https://github.com/mshindi-labs/google/commit/b285686dfa2132d8a8031d5ba63a4bc14b06340f))
