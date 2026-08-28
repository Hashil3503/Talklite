package com.talklite.config;

import com.talklite.auth.AuthenticatedUserArgumentResolver;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final AuthenticatedUserArgumentResolver resolver;

    public WebMvcConfig(AuthenticatedUserArgumentResolver resolver) {
        this.resolver = resolver;
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(resolver);
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // /api/images/** -> file:uploads/images/ (ImageUploadController 저장 경로와 일치)
        registry.addResourceHandler("/api/images/**")
                .addResourceLocations("file:uploads/images/");
    }
}
