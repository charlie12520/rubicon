Morning calendar refresh was slow because the full Morning brief was waiting on FirstSquawk/Godel live-feed pulls. FirstSquawk is currently failing through Nitter, so timeline + RSS fallback was dragging `/api/morning` to about 21.8s even though the actual calendar sources were ready much sooner.

Fixed it by making Morning brief load calendars/TC2000/cached live tape only, while FirstSquawk/Godel refresh separately in the background with shorter live-feed timeouts and no overlapping 10s pulls. `/api/morning` now measured about 1.7s; focused tests, typecheck, build, and Browser QA passed.
