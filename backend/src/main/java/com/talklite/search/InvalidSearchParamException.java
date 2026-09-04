package com.talklite.search;

/**
 * 검색 정렬 파라미터 화이트리스트 위반 시 400 응답용 예외 (P0-05).
 * error 코드는 invalid_sort / invalid_order 로 구분한다.
 */
public class InvalidSearchParamException extends RuntimeException {

    private final String code;

    public InvalidSearchParamException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}