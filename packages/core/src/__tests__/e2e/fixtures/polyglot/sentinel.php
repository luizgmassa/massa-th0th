<?php
class PolyPhp {
    public function run($value) { return $value; }
}
$poly_php_result = (new PolyPhp())->run(1);
