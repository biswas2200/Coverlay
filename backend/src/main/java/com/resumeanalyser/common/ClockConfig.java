package com.resumeanalyser.common;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.time.Clock;

/**
 * Supplies the clock the job, watchlist and saved-job services read "now"
 * from -- a bean so tests can pin it to a fixed instant.
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
