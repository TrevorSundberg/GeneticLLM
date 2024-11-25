#include <stdio.h>

int main() {
    int num1 = 0, num2 = 0;
    scanf("%d %d", &num1, &num2);

    if (num1 && num2) {
        int result = num1 + num2;
        printf("The result is: %d\n", result);
    } else {
        printf("Please provide two numbers.\n");
    }

    return 0;
}