# Changelog

## [1.3.2](https://github.com/baraka-mshindi/google/compare/google-v1.3.1...google-v1.3.2) (2026-11-24)


### Documentation

* publish a docs site to GitHub Pages and neutralise examples ([fbe319a](https://github.com/baraka-mshindi/google/commit/fbe319a3b9657c9f5b5c1b99ef0a39e07a033719))
* publish a VitePress docs site to GitHub Pages ([c3f7819](https://github.com/baraka-mshindi/google/commit/c3f7819cf662028ca04d0e5696fb2abe7d43ab06))
* replace internal project names and recruiting examples ([b06eef7](https://github.com/baraka-mshindi/google/commit/b06eef756d425be13b3d636ff949239ba8b9adf4))

## [1.3.1](https://github.com/baraka-mshindi/google/compare/google-v1.3.0...google-v1.3.1) (2026-11-17)


### Bug Fixes

* send the access token with Calendar and Sheets requests ([65738b9](https://github.com/baraka-mshindi/google/commit/65738b937cf056a0ef47c0469032787763f0276a))
* send the access token with Calendar and Sheets requests ([922ed37](https://github.com/baraka-mshindi/google/commit/922ed37bc4003fb1961cbf9ddc0d713edbcb0217))

## [1.3.0](https://github.com/baraka-mshindi/google/compare/google-v1.2.1...google-v1.3.0) (2026-11-17)


### Features

* **core:** add Sheets scope, errors and /sheets contracts ([c436fc2](https://github.com/baraka-mshindi/google/commit/c436fc285896dcbede324cbbd9790610035abf7b))
* **sheets:** add A1 utilities and literal-safe cell encoding ([4cedf2f](https://github.com/baraka-mshindi/google/commit/4cedf2f251ff10dcc4613fe0f4e5e6022e745a69))
* **sheets:** add batch request builders ([1d5e02a](https://github.com/baraka-mshindi/google/commit/1d5e02a90278215b570c12c3c3b191c5f008dad3))
* **sheets:** add Google Sheets API transport ([ef32b31](https://github.com/baraka-mshindi/google/commit/ef32b31e096d9eaa78ef9c069990770897ba6027))
* **sheets:** add idempotency-aware retry policy ([26814a1](https://github.com/baraka-mshindi/google/commit/26814a174e26e6fe7021515fe07c138205143400))
* **sheets:** add the /sheets service and publish the subpath ([b0fb11c](https://github.com/baraka-mshindi/google/commit/b0fb11c154088caa25180048e0f649b7677af273))
* **sheets:** add the /sheets subpath, migrated from @mshindi-labs/gsheets ([bedabc9](https://github.com/baraka-mshindi/google/commit/bedabc9c3cfcf7044d519fcd48bb9e68269983aa))
* **testing:** add FakeSheets transport ([1c855d7](https://github.com/baraka-mshindi/google/commit/1c855d71316261d91d64d8a1e7bd12c8dfc15914))


### Bug Fixes

* **sheets:** classify disabled-API 403s, unknown sheetIds and client init failures ([ca343f1](https://github.com/baraka-mshindi/google/commit/ca343f186aae49c5fc70b68b7c9f0e2d9ff857c4))
* **sheets:** fail closed on unknown input mode and empty formulas ([b3ad102](https://github.com/baraka-mshindi/google/commit/b3ad1024785fb8649434bc4c13dc30822b9d5bad))
* **sheets:** keep the optional sheets peer out of shared type declarations ([b91902e](https://github.com/baraka-mshindi/google/commit/b91902e5086d70e180d6c15cecb8862814f6f32e))
* **sheets:** look for the disabled-API reason without changing other reasons ([0f15bd4](https://github.com/baraka-mshindi/google/commit/0f15bd4d8367ef077f26c00b63dc4e448af84e91))
* **sheets:** reject mixed A1 pairs and reference-like named-range names ([effc903](https://github.com/baraka-mshindi/google/commit/effc90347165a4438998e87b8de311a2830d706e))
* **sheets:** retry pre-send TLS failures and parse quoted tabs ([1e94af4](https://github.com/baraka-mshindi/google/commit/1e94af4d3040c791c18e7039a85a9245d921e0ed))
* **testing:** tighten FakeSheets fidelity ([1da9f43](https://github.com/baraka-mshindi/google/commit/1da9f43ea4831430a4bda121bbdbf43feaf722ef))


### Code Refactoring

* **core:** share the connection token path ([e1ba283](https://github.com/baraka-mshindi/google/commit/e1ba283f1246e471556185627c3e04fa0de2c05f))
* **core:** share the retry loop ([760c098](https://github.com/baraka-mshindi/google/commit/760c0986d788429d75edcd0f248249c4c0a428d1))


### Documentation

* **sheets:** add /sheets design ([ff4d15e](https://github.com/baraka-mshindi/google/commit/ff4d15e77b70e440c5ecd751c1f4a0e0c1a7fca3))
* **sheets:** add /sheets implementation plan ([640ef33](https://github.com/baraka-mshindi/google/commit/640ef33a175ce012b1b692c294fd5df83aa5ab11))
* **sheets:** add Sheets guide and update spec ([ab8ca07](https://github.com/baraka-mshindi/google/commit/ab8ca077f25bc8da79475195b4dd15b75960aaf8))
* **sheets:** document the review fixes in the guide and spec ([1b2d66e](https://github.com/baraka-mshindi/google/commit/1b2d66e13c69b4fb219749009386c902a0dab143))
* **sheets:** fix range samples and column guidance ([e7c6ac3](https://github.com/baraka-mshindi/google/commit/e7c6ac3867735a3732c854437f176118607f1e75))
* **sheets:** include TLS failures in the I10 pre-send set ([882258d](https://github.com/baraka-mshindi/google/commit/882258dfd9cbeb0cd30c1ccf82f1ad5315c8ee32))
* **sheets:** say when id-less addTab ids are assigned ([b4a0bbe](https://github.com/baraka-mshindi/google/commit/b4a0bbe8a5f2b8fcabe658e35ff0e2d7f35e2f38))
* **sheets:** spell out a1 return shapes and getRows keys ([2271e75](https://github.com/baraka-mshindi/google/commit/2271e757aca60e4b211d23dfd7a9ffa232c38d8a))

## [1.2.1](https://github.com/baraka-mshindi/google/compare/google-v1.2.0...google-v1.2.1) (2026-11-16)


### Bug Fixes

* **package:** point repository metadata at baraka-mshindi/google ([46fdfc3](https://github.com/baraka-mshindi/google/commit/46fdfc3e685f9ed76578bbd1442825177120ce61))
* **package:** point repository metadata at baraka-mshindi/google ([4988511](https://github.com/baraka-mshindi/google/commit/498851160e504c4439f7f4b18015bc212f32f18d))

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
