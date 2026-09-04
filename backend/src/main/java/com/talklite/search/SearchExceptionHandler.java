package com.talklite.search;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class SearchExceptionHandler {

    @ExceptionHandler(InvalidSearchParamException.class)
    ResponseEntity<Map<String, String>> invalidSearchParam(InvalidSearchParamException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getCode()));
    }
}