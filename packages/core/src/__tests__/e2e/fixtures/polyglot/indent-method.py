class Outer:
    class Inner:
        def deeply_nested_method(self, x):
            return x + 1

    def top_level_method(self, y):
        return y * 2


def module_function(z):
    return z - 1


def use_outer():
    return Outer()
